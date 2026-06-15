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

const present = (key: string) => !!process.env[key]?.trim()

const any = (keys: ReadonlyArray<string>, apiKey: string | undefined) =>
  !!apiKey?.trim() || keys.some(present)

type ProviderAdapter = {
  readonly available: (
    keys: ReadonlyArray<string>,
    apiKey: string | undefined
  ) => boolean
  readonly supportsModel: (model: string) => boolean
  readonly layer: (
    dataDir: string,
    selection: ModelSelection,
    auth: ProviderAuth | undefined,
    apiKey: string | undefined,
    authStore: ProviderAuthStoreApi
  ) => ModelServiceLayer
}

// oxlint-disable-next-line sorato/no-manual-effect-channels -- adapter registry needs a shared layer contract
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

const anthropicOutputLimit = (modelId: string) =>
  MODEL_PROVIDERS.find((item) => item.id === 'anthropic')?.models.find(
    (model) => model.id === modelId
  )?.capabilities.limits.output ?? 4096

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
    available: any,
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
      return AnthropicMessages.layer({
        model: selection.id,
        apiKey: apiKey ?? '',
        capabilities: {
          maxOutputTokens: anthropicOutputLimit(selection.id),
        },
        ...(thinking !== undefined ? { thinking } : {}),
        onRetry: selection.onRetry,
      }).pipe(Layer.provide(FetchHttpClient.layer))
    },
  },
  openai: {
    available: any,
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
      const serviceTier = selection.mode === 'fast' ? 'flex' : undefined
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
