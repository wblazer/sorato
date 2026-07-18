import { Config, Effect, Layer } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { FetchHttpClient, HttpClientRequest } from 'effect/unstable/http'
import { MODEL_PROVIDERS } from './models.generated.ts'
import type { ModelSelection } from './model-catalog.ts'
import {
  ORIGINATOR,
  currentOpenAiOauth,
  soratoUserAgent,
} from './openai-chatgpt-auth.ts'
import type { ProviderAuth, ProviderAuthStoreApi } from './provider-auth.ts'
import type { ProviderId } from './provider-definitions.ts'
import * as AnthropicMessages from './providers/anthropic-messages.ts'
import type { AnthropicThinking } from './providers/anthropic-messages.ts'
import * as OpenAiResponses from './providers/openai-responses.ts'
import type { OpenAiReasoning } from './providers/openai-responses.ts'
import { reasoningOptionsOf, resolveReasoning } from './reasoning-options.ts'

const available = (apiKey: string | undefined) => !!apiKey?.trim()

type ProviderAdapter = {
  readonly available: (apiKey: string | undefined) => boolean
  readonly supportsModel: (model: string) => boolean
  readonly layer: (
    dataDir: string,
    selection: ModelSelection,
    auth: ProviderAuth | undefined,
    apiKey: string | undefined,
    authStore: ProviderAuthStoreApi
  ) => ModelServiceLayer
}

type ModelServiceLayer = Layer.Layer<
  LanguageModel.LanguageModel,
  Config.ConfigError
>

const modelIds = (provider: ProviderId): ReadonlySet<string> =>
  new Set<string>(
    MODEL_PROVIDERS.find((item) => item.id === provider)?.models.map(
      (model) => model.id
    ) ?? []
  )

const anthropicCatalogModels = modelIds('anthropic')
const openAiModels = modelIds('openai')

const catalogModel = (provider: ProviderId, modelId: string) =>
  MODEL_PROVIDERS.find((item) => item.id === provider)?.models.find(
    (model) => model.id === modelId
  )

const anthropicOutputLimit = (modelId: string) =>
  catalogModel('anthropic', modelId)?.capabilities.limits.output ?? 4096

type ModeOverride = {
  readonly body?: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
}

const modeOverridesOf = (
  capabilities: object
): Readonly<Record<string, ModeOverride>> | undefined =>
  'modeOverrides' in capabilities
    ? (capabilities.modeOverrides as Readonly<Record<string, ModeOverride>>)
    : undefined

/**
 * The request-body override the catalog declares for the selected mode, sourced
 * from models.dev `experimental.modes`. Returns undefined when no mode is
 * selected or the model declares no override for it.
 *
 * Modes are model-specific and not interchangeable: e.g. OpenAI's `fast` mode
 * maps to `service_tier: 'priority'` (not `flex`, which OpenAI rejects with a
 * 400), while Anthropic's `fast` maps to `speed: 'fast'`. Driving behavior from
 * this data — rather than guessing — keeps us from sending values a model
 * rejects.
 */
const modeBody = (
  provider: ProviderId,
  selection: ModelSelection
): Readonly<Record<string, unknown>> | undefined => {
  if (selection.mode === undefined) return undefined
  const model = catalogModel(provider, selection.id)
  if (model === undefined) return undefined
  return modeOverridesOf(model.capabilities)?.[selection.mode]?.body
}

export const modeServiceTier = (
  provider: ProviderId,
  selection: ModelSelection
): string | undefined => {
  const tier = modeBody(provider, selection)?.['service_tier']
  return typeof tier === 'string' ? tier : undefined
}

/** Whether the selected mode requests Anthropic's `speed: "fast"`. */
export const modeWantsFastSpeed = (selection: ModelSelection): boolean =>
  modeBody('anthropic', selection)?.['speed'] === 'fast'

/**
 * Map a model selection onto the Anthropic provider's thinking config, driven
 * entirely by the model's captured `reasoningOptions` (no model-id guessing).
 *
 * Effort-type models get adaptive thinking with the selected effort passed
 * straight through; budget-type models get the named-ladder token budget. The
 * provider sizes `max_tokens` above the budget on its own.
 */
const anthropicThinking = (
  selection: ModelSelection
): { thinking?: AnthropicThinking } => {
  const request = resolveReasoning(
    reasoningOptionsOf('anthropic', selection.id),
    selection.thinkingLevel
  )
  if (request.kind === 'effort' && request.effort !== 'none') {
    return { thinking: { type: 'adaptive', effort: request.effort } }
  }
  if (request.kind === 'budget') {
    return { thinking: { type: 'enabled', budgetTokens: request.budgetTokens } }
  }
  return {}
}

/**
 * Map a model selection onto the OpenAI Responses reasoning config, driven
 * entirely by the model's captured `reasoningOptions`. The selected effort
 * (one of the model's own values, including `xhigh`/`none`) is passed straight
 * through with no clamping. `none` disables reasoning without a summary.
 */
const openAiReasoning = (
  selection: ModelSelection
): OpenAiReasoning | undefined => {
  const request = resolveReasoning(
    reasoningOptionsOf('openai', selection.id),
    selection.thinkingLevel
  )
  if (request.kind !== 'effort') return undefined
  if (request.effort === 'none') return { effort: 'none' }
  return { effort: request.effort, summary: 'auto' }
}

/**
 * Per-request transform for the ChatGPT/Codex OAuth transport.
 *
 * Rewrites the URL to the Codex backend and injects fresh OAuth credentials
 * plus the originator/session/account headers. The Codex-specific request
 * shaping (`store: false`, system prompt hoisted to top-level `instructions`,
 * encrypted reasoning round-tripping) is owned by the provider via
 * `systemAsInstructions` + `store`, so no body patching is needed here.
 */
const codexTransformRequest =
  (authStore: ProviderAuthStoreApi, selection: ModelSelection) =>
  (request: HttpClientRequest.HttpClientRequest) =>
    Effect.gen(function* () {
      const current = yield* currentOpenAiOauth(authStore).pipe(Effect.orDie)
      let next = request.pipe(
        HttpClientRequest.setUrl(
          'https://chatgpt.com/backend-api/codex/responses'
        ),
        HttpClientRequest.setHeader(
          'authorization',
          `Bearer ${current.access}`
        ),
        HttpClientRequest.setHeader('originator', ORIGINATOR),
        HttpClientRequest.setHeader('User-Agent', soratoUserAgent())
      )
      if (selection.sessionId !== undefined) {
        next = HttpClientRequest.setHeader(
          'session_id',
          selection.sessionId
        )(next)
      }
      if (current.accountId !== undefined) {
        next = HttpClientRequest.setHeader(
          'ChatGPT-Account-Id',
          current.accountId
        )(next)
      }
      return next
    })

export const PROVIDER_ADAPTERS = {
  anthropic: {
    available,
    // No generated-enum gate: any catalog model id is accepted, and unknown
    // ids are forwarded verbatim by the provider.
    supportsModel: (model: string) => anthropicCatalogModels.has(model),
    layer: (
      _dataDir: string,
      selection: ModelSelection,
      _auth: ProviderAuth | undefined,
      apiKey: string | undefined
    ) => {
      const { thinking } = anthropicThinking(selection)
      const fast = modeWantsFastSpeed(selection)
      return AnthropicMessages.layer({
        model: selection.id,
        apiKey: apiKey ?? '',
        capabilities: {
          maxOutputTokens: anthropicOutputLimit(selection.id),
        },
        ...(thinking !== undefined ? { thinking } : {}),
        ...(fast ? { fast: true } : {}),
        onRetry: selection.onRetry,
      }).pipe(Layer.provide(FetchHttpClient.layer))
    },
  },
  openai: {
    available,
    // No generated-enum gate: any catalog model id is accepted, and unknown
    // ids are forwarded verbatim by the provider.
    supportsModel: (model: string) => openAiModels.has(model),
    layer: (
      _dataDir: string,
      selection: ModelSelection,
      auth: ProviderAuth | undefined,
      apiKey: string | undefined,
      authStore: ProviderAuthStoreApi
    ) => {
      const reasoning = openAiReasoning(selection)
      const serviceTier = modeServiceTier('openai', selection)
      const isOauth = auth?.type === 'oauth'

      return OpenAiResponses.layer({
        model: selection.id,
        ...(isOauth ? {} : { apiKey: apiKey ?? '' }),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {}),
        onRetry: selection.onRetry,
        ...(isOauth
          ? {
              store: false,
              systemAsInstructions: true,
              transformRequest: codexTransformRequest(authStore, selection),
            }
          : {}),
      }).pipe(Layer.provide(FetchHttpClient.layer))
    },
  },
} satisfies Record<ProviderId, ProviderAdapter>
