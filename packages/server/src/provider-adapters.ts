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

const supportsAnthropicAdaptiveThinking = (modelId: string) =>
  modelId.includes('claude-sonnet-4-6') ||
  modelId.includes('claude-opus-4-6') ||
  modelId.includes('claude-opus-4-7')

const anthropicAdaptiveEffort = (selection: ModelSelection) => {
  if (selection.thinkingLevel === 'low') return 'low' as const
  if (selection.thinkingLevel === 'medium') return 'medium' as const
  if (selection.thinkingLevel === 'high') return 'high' as const
  return undefined
}

const anthropicOutputLimit = (modelId: string) =>
  MODEL_PROVIDERS.find((item) => item.id === 'anthropic')?.models.find(
    (model) => model.id === modelId
  )?.capabilities.limits.output ?? 4096

const anthropicThinkingBudget = (selection: ModelSelection) => {
  if (selection.thinkingLevel === 'minimal') return 1024
  if (selection.thinkingLevel === 'low') return 2048
  if (selection.thinkingLevel === 'medium') return 8192
  if (selection.thinkingLevel === 'high') return 16384
  if (selection.thinkingLevel === 'xhigh') return 31999
  return undefined
}

/**
 * Map a model selection onto the new Anthropic provider's thinking config.
 *
 * Mirrors the prior `@effect/ai-anthropic` behavior: adaptive effort for models
 * that support it, otherwise a token budget capped to the model's output limit,
 * with `max_tokens` sized to leave room above the budget.
 */
const anthropicThinking = (
  selection: ModelSelection
): { thinking?: AnthropicThinking; maxTokens?: number } => {
  const effort = anthropicAdaptiveEffort(selection)
  if (effort !== undefined && supportsAnthropicAdaptiveThinking(selection.id)) {
    return { thinking: { type: 'adaptive', effort } }
  }

  const targetBudget = anthropicThinkingBudget(selection)
  if (!targetBudget) return {}

  const outputLimit = anthropicOutputLimit(selection.id)
  const budgetTokens = Math.min(targetBudget, outputLimit - 1024)
  if (budgetTokens < 1024) return {}

  return {
    thinking: { type: 'enabled', budgetTokens },
    maxTokens: Math.min(outputLimit, budgetTokens + 4096),
  }
}

/**
 * Map a model selection onto the OpenAI Responses reasoning config.
 *
 * Each thinking level becomes a reasoning `effort` hint with an automatic
 * summary. The OpenAI Responses API only accepts `minimal`/`low`/`medium`/
 * `high`, and Sorato's catalog never offers `xhigh` for OpenAI models, so the
 * (unreachable) `xhigh` case is clamped to `high` rather than sent verbatim and
 * rejected. Non-reasoning selections disable reasoning entirely.
 */
const openAiReasoning = (
  selection: ModelSelection
): OpenAiReasoning | undefined => {
  const level = selection.thinkingLevel
  if (level === 'minimal' || level === 'low' || level === 'medium') {
    return { effort: level, summary: 'auto' }
  }
  if (level === 'high' || level === 'xhigh') {
    return { effort: 'high', summary: 'auto' }
  }
  return undefined
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
      const { thinking, maxTokens } = anthropicThinking(selection)
      return AnthropicMessages.layer({
        model: selection.id,
        apiKey: apiKey ?? '',
        capabilities: {
          maxOutputTokens: anthropicOutputLimit(selection.id),
        },
        ...(thinking !== undefined ? { thinking } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
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
