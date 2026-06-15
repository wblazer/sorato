/**
 * A `LanguageModel.LanguageModel` implementation backed directly by the OpenAI
 * Responses wire API, built on `effect/unstable/http` +
 * `effect/unstable/encoding/Sse` — with **no dependency on `@effect/ai-openai`**.
 *
 * Like the sibling `anthropic-messages` provider, the point is to own the seam
 * below `LanguageModel.make`:
 *
 *   - `generateText(options) => Effect<Array<Response.PartEncoded>>`
 *   - `streamText(options)   => Stream<Response.StreamPartEncoded>`
 *
 * Everything above (`Prompt`, `Chat`, `Toolkit`, `Tool`, the harness loop, the
 * SQLite persistence schema) is reused unchanged. `model` is a plain `string`
 * with no generated-enum gate.
 *
 * Two transports are supported through one config:
 *
 *   - Direct API key: bearer auth against `https://api.openai.com/v1/responses`.
 *   - ChatGPT/Codex OAuth: the caller injects a `transformRequest` hook that
 *     rewrites the URL + headers per request. The Codex backend requires
 *     `store: false`, the system prompt hoisted to top-level `instructions`
 *     (`systemAsInstructions`), and reasoning `encrypted_content` round-tripped
 *     across turns — all handled here rather than via fragile body patches.
 */
import {
  Data,
  DateTime,
  Effect,
  Filter,
  Layer,
  Option,
  Schema,
  Stream,
} from 'effect'
import {
  AiError,
  LanguageModel,
  type Prompt,
  type Response,
  Tool,
} from 'effect/unstable/ai'
import * as Sse from 'effect/unstable/encoding/Sse'
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/unstable/http'

// =============================================================================
// Configuration
// =============================================================================

/** Per-model capabilities supplied by the caller (from our own catalog). */
export interface OpenAiModelCapabilities {
  /** Optional cap on output tokens (`max_output_tokens`). Omitted when absent. */
  readonly maxOutputTokens?: number | undefined
}

/** Reasoning configuration for the Responses API. */
export interface OpenAiReasoning {
  /** Free-form effort hint (`minimal` | `low` | `medium` | `high` | ...). */
  readonly effort: string
  /** Reasoning summary mode. Defaults to omitted. */
  readonly summary?: 'auto' | 'concise' | 'detailed' | undefined
}

export interface OpenAiResponsesConfig {
  /** Free-form model id. No enum, no validation. */
  readonly model: string
  /** Bearer API key. Omit when `transformRequest` supplies its own auth. */
  readonly apiKey?: string | undefined
  /** Base URL. Defaults to `https://api.openai.com/v1`. */
  readonly apiUrl?: string | undefined
  readonly capabilities?: OpenAiModelCapabilities | undefined
  /** Reasoning effort/summary. Omit to disable reasoning. */
  readonly reasoning?: OpenAiReasoning | undefined
  /** Service tier (`flex`, `priority`, ...). Omitted when absent. */
  readonly serviceTier?: string | undefined
  /**
   * `store` flag. When `false` on a reasoning request, encrypted reasoning
   * content is requested via `include` and round-tripped on later turns.
   */
  readonly store?: boolean | undefined
  /**
   * Hoist the system prompt into top-level `instructions` instead of emitting a
   * `system`/`developer` input item. Required by the Codex backend.
   */
  readonly systemAsInstructions?: boolean | undefined
  /** Extra static headers. */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** Per-request transform (URL rewrite, dynamic auth headers, ...). */
  readonly transformRequest?:
    | ((
        request: HttpClientRequest.HttpClientRequest
      ) => Effect.Effect<HttpClientRequest.HttpClientRequest>)
    | undefined
  /** Response transform applied before parsing. */
  readonly transformResponse?:
    | ((
        response: HttpClientResponse.HttpClientResponse
      ) => HttpClientResponse.HttpClientResponse)
    | undefined
}

const DEFAULT_API_URL = 'https://api.openai.com/v1'

// =============================================================================
// Errors
// =============================================================================

class OpenAiTransportError extends Data.TaggedError('OpenAiTransportError')<{
  readonly cause: unknown
}> {}

const toAiError =
  (method: string) =>
  (cause: unknown): AiError.AiError =>
    AiError.make({
      module: 'OpenAiResponses',
      method,
      reason: new AiError.InternalProviderError({
        description: cause instanceof Error ? cause.message : String(cause),
      }),
    })

// =============================================================================
// Wire schemas (request side is plain objects; response/SSE decoded)
// =============================================================================

const Usage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  input_tokens_details: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ cached_tokens: Schema.optional(Schema.Number) })
    )
  ),
  output_tokens_details: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ reasoning_tokens: Schema.optional(Schema.Number) })
    )
  ),
})
type Usage = typeof Usage.Type

const IncompleteDetails = Schema.NullOr(
  Schema.Struct({ reason: Schema.optional(Schema.NullOr(Schema.String)) })
)

const ResponseObject = Schema.Struct({
  id: Schema.String,
  model: Schema.optional(Schema.String),
  created_at: Schema.optional(Schema.Number),
  usage: Schema.optional(Schema.NullOr(Usage)),
  incomplete_details: Schema.optional(IncompleteDetails),
  service_tier: Schema.optional(Schema.NullOr(Schema.String)),
})

// --- output items (shared by non-streaming response + stream item events) ----

const MessageItem = Schema.Struct({
  type: Schema.Literal('message'),
  id: Schema.String,
  content: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
      })
    )
  ),
})

const ReasoningItem = Schema.Struct({
  type: Schema.Literal('reasoning'),
  id: Schema.String,
  encrypted_content: Schema.optional(Schema.NullOr(Schema.String)),
  summary: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.optional(Schema.String),
        text: Schema.String,
      })
    )
  ),
})

const FunctionCallItem = Schema.Struct({
  type: Schema.Literal('function_call'),
  id: Schema.optional(Schema.String),
  call_id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
})

// Only the item kinds the harness consumes are modelled. Any other kind fails
// to decode and is skipped — both in the SSE stream and the response body.
const OutputItem = Schema.Union([MessageItem, ReasoningItem, FunctionCallItem])
const decodeOutputItem = Schema.decodeUnknownOption(OutputItem)

// Non-streaming response. `output` stays untyped so unmodelled item kinds do
// not fail the whole decode; each item is decoded individually below.
const MessageResponse = Schema.Struct({
  id: Schema.String,
  model: Schema.optional(Schema.String),
  created_at: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Array(Schema.Unknown)),
  usage: Schema.optional(Schema.NullOr(Usage)),
  incomplete_details: Schema.optional(IncompleteDetails),
  service_tier: Schema.optional(Schema.NullOr(Schema.String)),
})

// --- stream events -----------------------------------------------------------

const ResponseLifecycle = <const T extends string>(type: T) =>
  Schema.Struct({ type: Schema.Literal(type), response: ResponseObject })

const StreamEvent = Schema.Union([
  ResponseLifecycle('response.created'),
  ResponseLifecycle('response.completed'),
  ResponseLifecycle('response.incomplete'),
  ResponseLifecycle('response.failed'),
  Schema.Struct({
    type: Schema.Literal('response.output_item.added'),
    output_index: Schema.Number,
    item: OutputItem,
  }),
  Schema.Struct({
    type: Schema.Literal('response.output_item.done'),
    output_index: Schema.Number,
    item: OutputItem,
  }),
  Schema.Struct({
    type: Schema.Literal('response.output_text.delta'),
    item_id: Schema.String,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('response.reasoning_summary_part.added'),
    item_id: Schema.String,
    summary_index: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal('response.reasoning_summary_text.delta'),
    item_id: Schema.String,
    summary_index: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('response.reasoning_summary_part.done'),
    item_id: Schema.String,
    summary_index: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal('response.function_call_arguments.delta'),
    output_index: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('response.function_call_arguments.done'),
    output_index: Schema.Number,
    item_id: Schema.String,
    arguments: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal('error'), error: Schema.Unknown }),
])
type StreamEvent = typeof StreamEvent.Type
const decodeStreamEvent = Schema.decodeUnknownOption(StreamEvent)

// =============================================================================
// Prompt part options (decoded via Schema rather than property probing)
// =============================================================================

const OpenAiPartOptions = Schema.Struct({
  itemId: Schema.optional(Schema.NullOr(Schema.String)),
  encryptedContent: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
})
const decodeOpenAiOptions = Schema.decodeUnknownOption(OpenAiPartOptions)

const openAiOptions = (
  options: Prompt.ProviderOptions | undefined
): typeof OpenAiPartOptions.Type | undefined =>
  Option.getOrUndefined(decodeOpenAiOptions(options?.openai))

const itemId = (
  options: Prompt.ProviderOptions | undefined
): string | undefined => openAiOptions(options)?.itemId ?? undefined
const encryptedContent = (
  options: Prompt.ProviderOptions | undefined
): string | undefined => openAiOptions(options)?.encryptedContent ?? undefined
const status = (
  options: Prompt.ProviderOptions | undefined
): string | undefined => openAiOptions(options)?.status ?? undefined

// =============================================================================
// Prompt -> Responses input translation
// =============================================================================

type Item = Record<string, unknown>
type SummaryText = { readonly type: 'summary_text'; readonly text: string }

/**
 * Reasoning models receive system prompts as `developer` messages because the
 * Responses API treats them differently.
 */
const systemMessageMode = (model: string): 'system' | 'developer' =>
  model.startsWith('o') ||
  model.startsWith('gpt-5') ||
  model.startsWith('codex-') ||
  model.startsWith('computer-use')
    ? 'developer'
    : 'system'

const translateInput = (
  config: OpenAiResponsesConfig,
  prompt: Prompt.Prompt
): {
  readonly input: Array<Item>
  readonly instructions: string | undefined
} => {
  const input: Array<Item> = []
  let instructions: string | undefined

  for (const message of prompt.content) {
    switch (message.role) {
      case 'system': {
        if (config.systemAsInstructions) {
          instructions =
            instructions === undefined
              ? message.content
              : `${instructions}\n\n${message.content}`
        } else {
          input.push({
            role: systemMessageMode(config.model),
            content: message.content,
          })
        }
        break
      }

      case 'user': {
        const content: Array<Item> = []
        for (const part of message.content) {
          if (part.type === 'text') {
            content.push({ type: 'input_text', text: part.text })
          }
          // (image/file parts omitted here)
        }
        input.push({ role: 'user', content })
        break
      }

      case 'assistant': {
        // Reasoning summary parts that share an item id collapse back into a
        // single reasoning item carrying all summaries + encrypted content.
        const reasoning = new Map<
          string,
          { readonly summary: Array<SummaryText>; readonly item: Item }
        >()

        for (const part of message.content) {
          switch (part.type) {
            case 'text': {
              const id = itemId(part.options)
              if (config.store === true && id !== undefined) {
                input.push({ type: 'item_reference', id })
                break
              }
              input.push({
                type: 'message',
                role: 'assistant',
                status: status(part.options) ?? 'completed',
                content: [
                  { type: 'output_text', text: part.text, annotations: [] },
                ],
                ...(id !== undefined ? { id } : {}),
              })
              break
            }

            case 'reasoning': {
              const id = itemId(part.options)
              if (id === undefined) break
              const enc = encryptedContent(part.options)
              if (config.store === true) {
                if (!reasoning.has(id)) {
                  input.push({ type: 'item_reference', id })
                  reasoning.set(id, { summary: [], item: {} })
                }
                break
              }
              const newSummary: Array<SummaryText> =
                part.text.length > 0
                  ? [{ type: 'summary_text', text: part.text }]
                  : []
              const existing = reasoning.get(id)
              if (existing === undefined) {
                const summary: Array<SummaryText> = [...newSummary]
                const item: Item = {
                  type: 'reasoning',
                  id,
                  summary,
                  ...(enc !== undefined ? { encrypted_content: enc } : {}),
                }
                reasoning.set(id, { summary, item })
                input.push(item)
              } else {
                existing.summary.push(...newSummary)
                if (enc !== undefined) existing.item.encrypted_content = enc
              }
              break
            }

            case 'tool-call': {
              const id = itemId(part.options)
              const s = status(part.options)
              if (config.store === true && id !== undefined) {
                input.push({ type: 'item_reference', id })
                break
              }
              input.push({
                type: 'function_call',
                name: part.name,
                call_id: part.id,
                arguments: JSON.stringify(part.params),
                ...(id !== undefined ? { id } : {}),
                ...(s !== undefined ? { status: s } : {}),
              })
              break
            }
          }
        }
        break
      }

      case 'tool': {
        for (const part of message.content) {
          if (part.type !== 'tool-result') continue
          const s = status(part.options)
          input.push({
            type: 'function_call_output',
            call_id: part.id,
            output: JSON.stringify(part.result),
            ...(s !== undefined ? { status: s } : {}),
          })
        }
        break
      }
    }
  }

  return { input, instructions }
}

const translateTools = (
  tools: ReadonlyArray<Tool.Any>
): Array<Item> | undefined => {
  const userTools = tools.filter(
    (tool) => Tool.isUserDefined(tool) || Tool.isDynamic(tool)
  )
  if (userTools.length === 0) return undefined
  return userTools.map((tool) => {
    const description = Tool.getDescription(tool)
    return {
      type: 'function',
      name: tool.name,
      parameters: Tool.getJsonSchema(tool),
      strict: false,
      ...(description !== undefined ? { description } : {}),
    }
  })
}

const toolChoice = (
  choice: LanguageModel.ProviderOptions['toolChoice']
): unknown => {
  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice
  }
  if (typeof choice === 'object' && 'tool' in choice) {
    return { type: 'function', name: choice.tool }
  }
  return undefined
}

const buildPayload = (
  config: OpenAiResponsesConfig,
  options: LanguageModel.ProviderOptions,
  stream: boolean
): Item => {
  const { input, instructions } = translateInput(config, options.prompt)
  const tools = translateTools(options.tools)
  const choice = toolChoice(options.toolChoice)
  const include: Array<string> = []
  if (config.store === false && config.reasoning !== undefined) {
    include.push('reasoning.encrypted_content')
  }
  const maxOutputTokens = config.capabilities?.maxOutputTokens

  return {
    model: config.model,
    input,
    stream,
    ...(instructions !== undefined ? { instructions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(choice !== undefined ? { tool_choice: choice } : {}),
    ...(config.reasoning !== undefined
      ? {
          reasoning: {
            effort: config.reasoning.effort,
            ...(config.reasoning.summary !== undefined
              ? { summary: config.reasoning.summary }
              : {}),
          },
        }
      : {}),
    ...(config.serviceTier !== undefined
      ? { service_tier: config.serviceTier }
      : {}),
    ...(config.store !== undefined ? { store: config.store } : {}),
    ...(include.length > 0 ? { include } : {}),
    ...(maxOutputTokens !== undefined
      ? { max_output_tokens: maxOutputTokens }
      : {}),
  }
}

// =============================================================================
// Finish reason + usage mapping
// =============================================================================

const FINISH_REASONS: Record<string, Response.FinishReason> = {
  content_filter: 'content-filter',
  function_call: 'tool-calls',
  length: 'length',
  stop: 'stop',
  tool_calls: 'tool-calls',
}

const finishReason = (
  raw: string | null | undefined,
  hasToolCalls: boolean
): Response.FinishReason => {
  if (raw == null) return hasToolCalls ? 'tool-calls' : 'stop'
  return FINISH_REASONS[raw] ?? (hasToolCalls ? 'tool-calls' : 'unknown')
}

const usageEncoded = (
  usage: Usage | null | undefined
): Response.FinishPartEncoded['usage'] => {
  const input = usage?.input_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  const cacheRead = usage?.input_tokens_details?.cached_tokens ?? 0
  const reasoning = usage?.output_tokens_details?.reasoning_tokens ?? 0
  return {
    inputTokens: {
      uncached: input - cacheRead,
      total: input,
      cacheRead,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output - reasoning,
      reasoning,
    },
  }
}

const serviceTierMetadata = (
  value: string | null | undefined
): Pick<Response.FinishPartEncoded, 'metadata'> => {
  switch (value) {
    case 'default':
    case 'auto':
    case 'flex':
    case 'scale':
    case 'priority':
      return { metadata: { openai: { serviceTier: value } } }
    default:
      return {}
  }
}

const openaiItemMetadata = (
  id: string | undefined,
  enc?: string | undefined
):
  | { readonly metadata: { readonly openai: Record<string, string> } }
  | undefined => {
  const openai: Record<string, string> = {}
  if (id !== undefined) openai.itemId = id
  if (enc !== undefined) openai.encryptedContent = enc
  return Object.keys(openai).length > 0 ? { metadata: { openai } } : undefined
}

// =============================================================================
// HTTP
// =============================================================================

const postResponses = (
  client: HttpClient.HttpClient,
  config: OpenAiResponsesConfig,
  payload: Item
) =>
  Effect.gen(function* () {
    let request = HttpClientRequest.post('/responses').pipe(
      HttpClientRequest.prependUrl(config.apiUrl ?? DEFAULT_API_URL),
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe(payload)
    )
    if (config.apiKey !== undefined) {
      request = HttpClientRequest.bearerToken(config.apiKey)(request)
    }
    if (config.headers !== undefined) {
      request = HttpClientRequest.setHeaders(config.headers)(request)
    }
    if (config.transformRequest !== undefined) {
      request = yield* config.transformRequest(request)
    }
    const response = yield* HttpClient.filterStatusOk(client).execute(request)
    return config.transformResponse !== undefined
      ? config.transformResponse(response)
      : response
  }).pipe(Effect.mapError((cause) => new OpenAiTransportError({ cause })))

const requestDetails = (
  response: HttpClientResponse.HttpClientResponse
): typeof Response.HttpRequestDetails.Type => ({
  method: response.request.method,
  url: response.request.url,
  urlParams: Array.from(response.request.urlParams),
  hash: Option.getOrUndefined(response.request.hash),
  headers: { ...response.request.headers },
})

// =============================================================================
// Streaming hook
// =============================================================================

type ReasoningState = {
  encryptedContent: string | undefined
  readonly summaryParts: Record<number, 'active' | 'can-conclude' | 'concluded'>
}

const streamHook =
  (client: HttpClient.HttpClient, config: OpenAiResponsesConfig) =>
  (options: LanguageModel.ProviderOptions) => {
    const payload = buildPayload(config, options, true)

    const build = Effect.gen(function* () {
      const response = yield* postResponses(client, config, payload)
      const fallbackTimestamp = DateTime.formatIso(yield* DateTime.now)
      const request = requestDetails(response)

      const reasoning = new Map<string, ReasoningState>()
      const toolCalls = new Map<
        number,
        { readonly id: string; readonly name: string; emitted: boolean }
      >()
      let hasToolCalls = false

      const reasoningState = (
        id: string,
        enc?: string | null
      ): ReasoningState => {
        const existing = reasoning.get(id)
        if (existing !== undefined) {
          if (enc != null) existing.encryptedContent = enc
          return existing
        }
        const next: ReasoningState = {
          encryptedContent: enc ?? undefined,
          summaryParts: {},
        }
        reasoning.set(id, next)
        return next
      }

      return response.stream.pipe(
        Stream.decodeText(),
        Stream.pipeThroughChannel(Sse.decodeDataSchema(Schema.Unknown)),
        // Skip any event type we do not model rather than failing the stream.
        Stream.filterMap(
          Filter.fromPredicateOption((event: { readonly data: unknown }) =>
            decodeStreamEvent(event.data)
          )
        ),
        Stream.takeUntil(
          (event) =>
            event.type === 'response.completed' ||
            event.type === 'response.incomplete' ||
            event.type === 'response.failed'
        ),
        Stream.map((event): ReadonlyArray<Response.StreamPartEncoded> => {
          switch (event.type) {
            case 'response.created': {
              const createdAt = event.response.created_at
              return [
                {
                  type: 'response-metadata',
                  id: event.response.id,
                  modelId: event.response.model ?? config.model,
                  timestamp:
                    createdAt !== undefined
                      ? DateTime.formatIso(
                          DateTime.fromDateUnsafe(new Date(createdAt * 1000))
                        )
                      : fallbackTimestamp,
                  request,
                },
              ]
            }

            case 'response.completed':
            case 'response.incomplete':
            case 'response.failed':
              return [
                {
                  type: 'finish',
                  reason: finishReason(
                    event.response.incomplete_details?.reason,
                    hasToolCalls
                  ),
                  usage: usageEncoded(event.response.usage),
                  response: undefined,
                  ...serviceTierMetadata(event.response.service_tier),
                },
              ]

            case 'response.output_item.added': {
              const item = event.item
              if (item.type === 'message') {
                return [
                  {
                    type: 'text-start',
                    id: item.id,
                    ...openaiItemMetadata(item.id),
                  },
                ]
              }
              if (item.type === 'reasoning') {
                const state = reasoningState(item.id, item.encrypted_content)
                if (state.summaryParts[0] === undefined) {
                  state.summaryParts[0] = 'active'
                  return [
                    {
                      type: 'reasoning-start',
                      id: `${item.id}:0`,
                      ...openaiItemMetadata(item.id, state.encryptedContent),
                    },
                  ]
                }
                return []
              }
              if (item.type === 'function_call') {
                toolCalls.set(event.output_index, {
                  id: item.call_id,
                  name: item.name,
                  emitted: false,
                })
                return [
                  {
                    type: 'tool-params-start',
                    id: item.call_id,
                    name: item.name,
                  },
                ]
              }
              return []
            }

            case 'response.output_item.done': {
              const item = event.item
              if (item.type === 'message') {
                return [
                  {
                    type: 'text-end',
                    id: item.id,
                    ...openaiItemMetadata(item.id),
                  },
                ]
              }
              if (item.type === 'reasoning') {
                const state = reasoningState(item.id, item.encrypted_content)
                const parts: Array<Response.StreamPartEncoded> = []
                for (const [index, value] of Object.entries(
                  state.summaryParts
                )) {
                  if (value === 'active' || value === 'can-conclude') {
                    parts.push({
                      type: 'reasoning-end',
                      id: `${item.id}:${index}`,
                      ...openaiItemMetadata(item.id, state.encryptedContent),
                    })
                  }
                }
                reasoning.delete(item.id)
                return parts
              }
              if (item.type === 'function_call') {
                const active = toolCalls.get(event.output_index)
                toolCalls.delete(event.output_index)
                if (active === undefined || active.emitted) return []
                hasToolCalls = true
                return [
                  { type: 'tool-params-end', id: active.id },
                  {
                    type: 'tool-call',
                    id: active.id,
                    name: active.name,
                    params: Tool.unsafeSecureJsonParse(item.arguments),
                    ...openaiItemMetadata(item.id),
                  },
                ]
              }
              return []
            }

            case 'response.output_text.delta':
              return [
                { type: 'text-delta', id: event.item_id, delta: event.delta },
              ]

            case 'response.reasoning_summary_part.added': {
              const state = reasoningState(event.item_id)
              const parts: Array<Response.StreamPartEncoded> = []
              if (event.summary_index > 0) {
                for (const [index, value] of Object.entries(
                  state.summaryParts
                )) {
                  if (value === 'can-conclude') {
                    parts.push({
                      type: 'reasoning-end',
                      id: `${event.item_id}:${index}`,
                      ...openaiItemMetadata(
                        event.item_id,
                        state.encryptedContent
                      ),
                    })
                    state.summaryParts[Number(index)] = 'concluded'
                  }
                }
              }
              if (state.summaryParts[event.summary_index] === undefined) {
                state.summaryParts[event.summary_index] = 'active'
                parts.push({
                  type: 'reasoning-start',
                  id: `${event.item_id}:${event.summary_index}`,
                  ...openaiItemMetadata(event.item_id, state.encryptedContent),
                })
              }
              return parts
            }

            case 'response.reasoning_summary_text.delta':
              return [
                {
                  type: 'reasoning-delta',
                  id: `${event.item_id}:${event.summary_index}`,
                  delta: event.delta,
                  ...openaiItemMetadata(event.item_id),
                },
              ]

            case 'response.reasoning_summary_part.done': {
              const state = reasoningState(event.item_id)
              if (config.store === true) {
                state.summaryParts[event.summary_index] = 'concluded'
                return [
                  {
                    type: 'reasoning-end',
                    id: `${event.item_id}:${event.summary_index}`,
                    ...openaiItemMetadata(event.item_id),
                  },
                ]
              }
              state.summaryParts[event.summary_index] = 'can-conclude'
              return []
            }

            case 'response.function_call_arguments.delta': {
              const active = toolCalls.get(event.output_index)
              if (active === undefined) return []
              return [
                {
                  type: 'tool-params-delta',
                  id: active.id,
                  delta: event.delta,
                },
              ]
            }

            case 'response.function_call_arguments.done': {
              const active = toolCalls.get(event.output_index)
              if (active === undefined || active.emitted) return []
              active.emitted = true
              hasToolCalls = true
              return [
                { type: 'tool-params-end', id: active.id },
                {
                  type: 'tool-call',
                  id: active.id,
                  name: active.name,
                  params: Tool.unsafeSecureJsonParse(event.arguments),
                  ...openaiItemMetadata(event.item_id),
                },
              ]
            }

            case 'error':
              return [{ type: 'error', error: event.error }]

            default:
              return []
          }
        }),
        Stream.flattenIterable
      )
    })

    return build.pipe(Stream.unwrap, Stream.mapError(toAiError('streamText')))
  }

// =============================================================================
// Non-streaming hook
// =============================================================================

const generateHook =
  (client: HttpClient.HttpClient, config: OpenAiResponsesConfig) =>
  (options: LanguageModel.ProviderOptions) =>
    Effect.gen(function* () {
      const payload = buildPayload(config, options, false)
      const response = yield* postResponses(client, config, payload)
      const message = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MessageResponse))
      )

      const parts: Array<Response.PartEncoded> = []
      const createdAt = message.created_at
      parts.push({
        type: 'response-metadata',
        id: message.id,
        modelId: message.model ?? config.model,
        timestamp:
          createdAt !== undefined
            ? DateTime.formatIso(
                DateTime.fromDateUnsafe(new Date(createdAt * 1000))
              )
            : DateTime.formatIso(yield* DateTime.now),
        request: requestDetails(response),
      })

      let hasToolCalls = false
      for (const raw of message.output ?? []) {
        const item = Option.getOrUndefined(decodeOutputItem(raw))
        if (item === undefined) continue
        if (item.type === 'message') {
          for (const content of item.content ?? []) {
            if (content.type === 'output_text' && content.text !== undefined) {
              parts.push({
                type: 'text',
                text: content.text,
                ...openaiItemMetadata(item.id),
              })
            }
          }
        } else if (item.type === 'reasoning') {
          const meta = openaiItemMetadata(
            item.id,
            item.encrypted_content ?? undefined
          )
          const summaries = item.summary ?? []
          if (summaries.length === 0) {
            parts.push({ type: 'reasoning', text: '', ...meta })
          } else {
            for (const summary of summaries) {
              parts.push({ type: 'reasoning', text: summary.text, ...meta })
            }
          }
        } else if (item.type === 'function_call') {
          hasToolCalls = true
          parts.push({
            type: 'tool-call',
            id: item.call_id,
            name: item.name,
            params: Tool.unsafeSecureJsonParse(item.arguments),
            ...openaiItemMetadata(item.id),
          })
        }
      }

      parts.push({
        type: 'finish',
        reason: finishReason(message.incomplete_details?.reason, hasToolCalls),
        usage: usageEncoded(message.usage),
        response: undefined,
        ...serviceTierMetadata(message.service_tier),
      })

      return parts
    }).pipe(Effect.mapError(toAiError('generateText')))

// =============================================================================
// Public API
// =============================================================================

/** Build a `LanguageModel.Service` from an OpenAI Responses config. */
export const make = (config: OpenAiResponsesConfig) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* LanguageModel.make({
      generateText: generateHook(client, config),
      streamText: streamHook(client, config),
    })
  })

/** Layer providing `LanguageModel.LanguageModel`, requiring an `HttpClient`. */
export const layer = (
  config: OpenAiResponsesConfig
  // oxlint-disable-next-line sorato/no-manual-effect-channels -- public declaration boundary contract
): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> =>
  Layer.effect(LanguageModel.LanguageModel, make(config))

/** Convenience: read the API key from an environment variable as `Option`. */
export const apiKeyFromEnv = (name = 'OPENAI_API_KEY'): Option.Option<string> =>
  Option.fromNullishOr(process.env[name]?.trim() || undefined)
