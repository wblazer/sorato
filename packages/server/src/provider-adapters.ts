import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai'
import {
  Config,
  Effect,
  Layer,
  Match,
  Option,
  Redacted,
  Schema,
  Stream,
} from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
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
import * as AnthropicMessages from './providers/anthropic-messages.ts'
import type { AnthropicThinking } from './providers/anthropic-messages.ts'

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
const CodexInputItem = Schema.Record(Schema.String, Schema.Unknown)
const CodexInstructionItem = Schema.Struct({
  role: Schema.Literals(['system', 'developer']),
  content: Schema.String,
})

const removeEmptyRole = (item: unknown): unknown => {
  const inputItem = Schema.decodeUnknownOption(CodexInputItem)(item)
  return Option.match(inputItem, {
    onNone: () => item,
    onSome: (record) => {
      if (record.role !== '') return record
      const { role: _role, ...rest } = record
      return rest
    },
  })
}

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
      Schema.is(CodexInstructionItem)(item) && item.content.trim().length > 0
  )
  const inputInstructions = Match.value(instructionIndex >= 0).pipe(
    Match.when(true, () => {
      const item = input[instructionIndex]
      return Schema.is(CodexInstructionItem)(item) ? item.content : undefined
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

const patchMissingCompletedOutput = (line: string) => {
  if (!line.startsWith('data: ')) return line

  const payload = line.slice('data: '.length)
  if (
    !payload.includes('"type":"response.completed"') ||
    payload.includes('"output":')
  ) {
    return line
  }

  return `data: ${payload.replace(
    '"response":{"id"',
    '"response":{"output":[],"id"'
  )}`
}

const withCodexResponseCompatibility = (
  response: HttpClientResponse.HttpClientResponse
) => {
  const headers = new globalThis.Headers(response.headers)
  headers.delete('content-length')

  return HttpClientResponse.fromWeb(
    response.request,
    new Response(
      Stream.toReadableStream(
        response.stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.map((line) => `${patchMissingCompletedOutput(line)}\n`),
          Stream.encodeText
        )
      ),
      {
        headers,
        status: response.status,
      }
    )
  )
}

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
                    const current = yield* currentOpenAiOauth(authStore).pipe(
                      Effect.orDie
                    )

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
                ),
                HttpClient.transformResponse(
                  Effect.map(withCodexResponseCompatibility)
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
