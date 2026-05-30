import {
  AnthropicClient,
  AnthropicLanguageModel,
  Generated as AnthropicGenerated,
} from '@effect/ai-anthropic'
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai'
import { Config, Effect, Layer, Match, Redacted, Schema } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'
import { MODEL_PROVIDERS } from './models.generated.ts'
import type { ModelSelection } from './model-catalog.ts'
import {
  ORIGINATOR,
  currentOpenAiOauth,
  soratoUserAgent,
} from './openai-chatgpt-auth.ts'
import type { ProviderAuth, ProviderAuthStoreApi } from './provider-auth.ts'
import type { ProviderId } from './provider-definitions.ts'

const present = (key: string) => !!process.env[key]?.trim()
const keepRequest = <A>(item: A) => item

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

const CodexRequestBody = Schema.Struct({
  instructions: Schema.optional(Schema.String),
})
const CodexRequestRecord = Schema.Record(Schema.String, Schema.Unknown)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const removeEmptyRole = (item: unknown): unknown => {
  if (!isRecord(item) || item.role !== '') return item
  const { role: _role, ...rest } = item
  return rest
}

const modelIds = (provider: ProviderId): ReadonlySet<string> =>
  new Set<string>(
    MODEL_PROVIDERS.find((item) => item.id === provider)?.models.map(
      (model) => model.id
    ) ?? []
  )

const anthropicCatalogModels = modelIds('anthropic')
const isAnthropicRuntimeModel = Schema.is(AnthropicGenerated.Model)
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

const anthropicThinkingConfig = (selection: ModelSelection) => {
  const effort = anthropicAdaptiveEffort(selection)
  const adaptiveEffort = [undefined, effort][
    Number(supportsAnthropicAdaptiveThinking(selection.id))
  ]
  const adaptiveThinking = Match.value(adaptiveEffort).pipe(
    Match.when('low', (effort) => ({
      thinking: { type: 'adaptive' as const },
      output_config: { effort },
    })),
    Match.when('medium', (effort) => ({
      thinking: { type: 'adaptive' as const },
      output_config: { effort },
    })),
    Match.when('high', (effort) => ({
      thinking: { type: 'adaptive' as const },
      output_config: { effort },
    })),
    Match.orElse(() => undefined)
  )
  if (adaptiveThinking) return adaptiveThinking

  const targetBudget = anthropicThinkingBudget(selection)
  if (!targetBudget) return {}

  const outputLimit = anthropicOutputLimit(selection.id)
  const budgetTokens = Math.min(targetBudget, outputLimit - 1024)
  if (budgetTokens < 1024) return {}

  return {
    max_tokens: Math.min(outputLimit, budgetTokens + 4096),
    thinking: { type: 'enabled' as const, budget_tokens: budgetTokens },
  }
}

const withCodexInstructions = (
  request: HttpClientRequest.HttpClientRequest
) => {
  if (request.body._tag !== 'Uint8Array') return request

  const parsed = JSON.parse(new TextDecoder().decode(request.body.body))
  const rawBody = Schema.decodeUnknownSync(CodexRequestRecord)(parsed)
  const body = Schema.decodeUnknownSync(CodexRequestBody)(parsed)
  const input = Array.isArray(rawBody.input) ? rawBody.input : []
  const instructionIndex = input.findIndex(
    (item) =>
      isRecord(item) &&
      (item.role === 'system' || item.role === 'developer') &&
      typeof item.content === 'string' &&
      item.content.trim()
  )
  const inputInstructions = Match.value(instructionIndex >= 0).pipe(
    Match.when(true, () => {
      const item = input[instructionIndex]
      return isRecord(item) && typeof item.content === 'string'
        ? item.content
        : undefined
    }),
    Match.orElse(() => undefined)
  )
  const instructions = body.instructions ?? inputInstructions

  if (!instructions) return request

  return request.pipe(
    HttpClientRequest.bodyJsonUnsafe({
      ...rawBody,
      instructions,
      store: false,
      input: input
        .filter((_, index) => index !== instructionIndex)
        .map(removeEmptyRole),
    })
  )
}

export const PROVIDER_ADAPTERS = {
  anthropic: {
    available: any,
    supportsModel: (model: string) =>
      anthropicCatalogModels.has(model) && isAnthropicRuntimeModel(model),
    layer: (_dataDir: string, selection: ModelSelection) => {
      return AnthropicLanguageModel.layer({
        model: selection.id as AnthropicLanguageModel.Model,
        config: anthropicThinkingConfig(selection),
      }).pipe(
        Layer.provide(
          AnthropicClient.layerConfig({
            apiKey: Config.redacted('ANTHROPIC_API_KEY'),
          })
        ),
        Layer.provide(FetchHttpClient.layer)
      )
    },
  },
  openai: {
    available: any,
    supportsModel: (model: string) => openAiModels.has(model),
    layer: (
      _dataDir: string,
      selection: ModelSelection,
      auth: ProviderAuth | undefined,
      apiKey: string | undefined,
      authStore: ProviderAuthStoreApi
    ) => {
      const reasoning = Match.value(selection.thinkingLevel).pipe(
        Match.when('minimal', (effort) => ({
          reasoning: {
            effort,
            summary: 'auto' as const,
          },
        })),
        Match.when('low', (effort) => ({
          reasoning: { effort, summary: 'auto' as const },
        })),
        Match.when('medium', (effort) => ({
          reasoning: { effort, summary: 'auto' as const },
        })),
        Match.when('high', (effort) => ({
          reasoning: { effort, summary: 'auto' as const },
        })),
        Match.when('xhigh', (effort) => ({
          reasoning: { effort, summary: 'auto' as const },
        })),
        Match.orElse(() => ({}))
      )
      const serviceTier = Match.value(selection.mode).pipe(
        Match.when('fast', () => ({ service_tier: 'flex' as const })),
        Match.orElse(() => ({}))
      )

      const clientLayer = Match.value(auth?.type).pipe(
        Match.when('oauth', () =>
          OpenAiClient.layerConfig({
            apiKey: Config.succeed(Redacted.make('sorato-chatgpt-oauth')),
            transformClient: (client) =>
              client.pipe(
                HttpClient.mapRequestEffect((request) =>
                  Effect.gen(function* () {
                    const currentRaw = currentOpenAiOauth(authStore)
                    const currentMapped = Effect.mapError(
                      currentRaw,
                      (error) =>
                        new Error(
                          `Failed to refresh OpenAI ChatGPT credentials: ${error.message}`
                        )
                    )
                    const currentEffect = Effect.orDie(currentMapped)
                    const current = yield* currentEffect

                    const url = new URL(request.url)
                    const target =
                      [
                        request.url,
                        'https://chatgpt.com/backend-api/codex/responses',
                      ][Number(url.pathname.endsWith('/responses'))] ??
                      request.url
                    const setSessionId =
                      [
                        keepRequest,
                        HttpClientRequest.setHeader(
                          'session_id',
                          selection.sessionId ?? ''
                        ),
                      ][Number(selection.sessionId !== undefined)] ??
                      keepRequest
                    const setAccountId =
                      [
                        keepRequest,
                        HttpClientRequest.setHeader(
                          'ChatGPT-Account-Id',
                          current.accountId ?? ''
                        ),
                      ][Number(current.accountId !== undefined)] ?? keepRequest

                    return withCodexInstructions(request).pipe(
                      HttpClientRequest.setUrl(target),
                      HttpClientRequest.setHeader(
                        'authorization',
                        `Bearer ${current.access}`
                      ),
                      HttpClientRequest.setHeader('originator', ORIGINATOR),
                      HttpClientRequest.setHeader(
                        'User-Agent',
                        soratoUserAgent()
                      ),
                      setSessionId,
                      setAccountId
                    )
                  })
                )
              ),
          })
        ),
        Match.orElse(() =>
          OpenAiClient.layerConfig({
            apiKey: Config.succeed(Redacted.make(apiKey ?? '')),
          })
        )
      )

      return OpenAiLanguageModel.layer({
        model: selection.id as OpenAiLanguageModel.Model,
        config: {
          ...reasoning,
          ...serviceTier,
        },
      }).pipe(Layer.provide(clientLayer), Layer.provide(FetchHttpClient.layer))
    },
  },
} satisfies Record<ProviderId, ProviderAdapter>
