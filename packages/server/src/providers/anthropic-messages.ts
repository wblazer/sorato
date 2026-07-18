/**
 * Prototype: a `LanguageModel.LanguageModel` implementation backed directly by
 * the Anthropic Messages wire API, built on `effect/unstable/http` +
 * `effect/unstable/encoding/Sse` — with **no dependency on
 * `@effect/ai-anthropic`**.
 *
 * The point of this module is to validate the seam: `LanguageModel.make` only
 * asks a provider for two hooks
 *
 *   - `generateText(options) => Effect<Array<Response.PartEncoded>>`
 *   - `streamText(options)   => Stream<Response.StreamPartEncoded>`
 *
 * Everything above this seam (`Prompt`, `Chat`, `Toolkit`, `Tool`, the harness
 * loop, the SQLite persistence schema) is reused unchanged. Everything below it
 * — model id handling, capabilities, prompt translation, SSE parsing — is owned
 * here.
 *
 * Crucially, `model` is a plain `string`. There is no generated enum gate and no
 * runtime "is this a known model?" check. Capabilities (max output tokens, etc.)
 * are supplied by the caller from our own catalog, not hardcoded in the SDK.
 */
import { Data, DateTime, Effect, Layer, Option, Schema, Stream } from 'effect'
import {
  AiError,
  LanguageModel,
  type Prompt,
  type Response,
  Tool,
} from 'effect/unstable/ai'
import * as Sse from 'effect/unstable/encoding/Sse'
import { HttpClient, HttpClientRequest } from 'effect/unstable/http'
import {
  ensureOk,
  retryProviderRequest,
  type ProviderRetryHandler,
  toProviderAiError,
} from './provider-errors.ts'

// =============================================================================
// Configuration
// =============================================================================

/** Per-model capabilities supplied by the caller (from our own catalog). */
export interface AnthropicModelCapabilities {
  /** Hard cap on output tokens for this model. */
  readonly maxOutputTokens: number
}

/** Anthropic-specific request configuration. */
/**
 * Extended-thinking configuration.
 *
 * - `enabled`: classic token-budget thinking (`thinking.budget_tokens`).
 * - `adaptive`: server-chosen budget driven by an `effort` hint
 *   (`output_config.effort`), for models that support it.
 */
export type AnthropicThinking =
  | { readonly type: 'enabled'; readonly budgetTokens: number }
  | {
      // Free-form effort: the caller passes the model's own catalog value
      // (e.g. `low`/`medium`/`high`/`xhigh`/`max`) straight through.
      readonly type: 'adaptive'
      readonly effort?: string | undefined
    }

/**
 * Prompt-cache configuration.
 *
 * When `enabled`, the provider automatically places ephemeral `cache_control`
 * breakpoints on the stable prefix (tools + system) and on a rolling window of
 * the most recent messages, staying within Anthropic's hard cap of 4
 * breakpoints per request. Callers can still pin their own breakpoints via
 * `part.options.anthropic.cacheControl`; those are honored first.
 */
export interface AnthropicCache {
  readonly enabled?: boolean | undefined
  /** Cache lifetime. Defaults to `'5m'`. */
  readonly ttl?: '5m' | '1h' | undefined
}

export interface AnthropicConfig {
  /** Free-form model id. No enum, no validation. */
  readonly model: string
  /** API key (redacted handling is the caller's concern in real code). */
  readonly apiKey: string
  readonly apiUrl?: string | undefined
  readonly anthropicVersion?: string | undefined
  readonly capabilities: AnthropicModelCapabilities
  /** Extended-thinking configuration. Omit to disable thinking. */
  readonly thinking?: AnthropicThinking | undefined
  /**
   * Fast mode. When enabled, requests `speed: "fast"` and sends the fast-mode
   * beta header. Only supported on models that advertise it (Opus 4 family).
   */
  readonly fast?: boolean | undefined
  /** Prompt-cache configuration. Defaults to enabled, 5m TTL. */
  readonly cache?: AnthropicCache | undefined
  /** Override max_tokens; defaults to capabilities.maxOutputTokens. */
  readonly maxTokens?: number | undefined
  readonly onRetry?: ProviderRetryHandler | undefined
}

const DEFAULT_API_URL = 'https://api.anthropic.com'
const DEFAULT_VERSION = '2023-06-01'

// Beta gate for fast mode (`speed: "fast"`), required alongside the body field.
const FAST_MODE_BETA = 'fast-mode-2026-02-01'

// Anthropic accepts at most 4 explicit cache_control breakpoints per request,
// across `tools`, `system`, and `messages`. Beyond the cap the API returns a
// 400, so the lowering layer counts emitted markers and drops the excess.
const CACHE_BREAKPOINT_CAP = 4

// How many trailing messages get a rolling cache breakpoint. Two lets back-to-
// back turns read the prior turn's incremental cache write.
const ROLLING_CACHE_MESSAGES = 2

// =============================================================================
// Anthropic wire schemas (request side is plain objects; response/SSE decoded)
// =============================================================================

const Usage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_read_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
  cache_creation_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
})

const MessageStart = Schema.Struct({
  type: Schema.Literal('message_start'),
  message: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    usage: Usage,
  }),
})

const ContentBlockStart = Schema.Struct({
  type: Schema.Literal('content_block_start'),
  index: Schema.Number,
  content_block: Schema.Union([
    Schema.Struct({ type: Schema.Literal('text') }),
    Schema.Struct({ type: Schema.Literal('thinking') }),
    Schema.Struct({
      type: Schema.Literal('tool_use'),
      id: Schema.String,
      name: Schema.String,
      input: Schema.optional(Schema.Unknown),
    }),
  ]),
})

const ContentBlockDelta = Schema.Struct({
  type: Schema.Literal('content_block_delta'),
  index: Schema.Number,
  delta: Schema.Union([
    Schema.Struct({ type: Schema.Literal('text_delta'), text: Schema.String }),
    Schema.Struct({
      type: Schema.Literal('thinking_delta'),
      thinking: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal('signature_delta'),
      signature: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal('input_json_delta'),
      partial_json: Schema.String,
    }),
  ]),
})

const ContentBlockStop = Schema.Struct({
  type: Schema.Literal('content_block_stop'),
  index: Schema.Number,
})

const MessageDelta = Schema.Struct({
  type: Schema.Literal('message_delta'),
  delta: Schema.Struct({
    stop_reason: Schema.optional(Schema.NullOr(Schema.String)),
    stop_sequence: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  usage: Usage,
})

const MessageStop = Schema.Struct({ type: Schema.Literal('message_stop') })
const Ping = Schema.Struct({ type: Schema.Literal('ping') })
const ErrorEvent = Schema.Struct({
  type: Schema.Literal('error'),
  error: Schema.Unknown,
})

const StreamEvent = Schema.Union([
  MessageStart,
  ContentBlockStart,
  ContentBlockDelta,
  ContentBlockStop,
  MessageDelta,
  MessageStop,
  Ping,
  ErrorEvent,
])
type StreamEvent = typeof StreamEvent.Type

// Non-streaming response (for generateText)
const MessageResponse = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  content: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
      Schema.Struct({
        type: Schema.Literal('thinking'),
        thinking: Schema.String,
        signature: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        type: Schema.Literal('tool_use'),
        id: Schema.String,
        name: Schema.String,
        input: Schema.Unknown,
      }),
    ])
  ),
  stop_reason: Schema.NullOr(Schema.String),
  usage: Usage,
})

// =============================================================================
// Errors
// =============================================================================

class AnthropicTransportError extends Data.TaggedError(
  'AnthropicTransportError'
)<{
  readonly cause: unknown
}> {}

const toAiError =
  (method: string) =>
  (cause: unknown): AiError.AiError =>
    toProviderAiError('AnthropicMessages', method)(cause)

// =============================================================================
// Prompt cache control
// =============================================================================

type CacheControl = { readonly type: 'ephemeral'; readonly ttl?: '1h' }

/** A mutable wire block onto which `cache_control` can be attached in-place. */
type Block = Record<string, unknown>

const base64Data = (data: string): string | undefined => {
  const marker = ';base64,'
  const index = data.indexOf(marker)
  return index === -1 ? undefined : data.slice(index + marker.length)
}

type WireMessage = {
  readonly role: 'user' | 'assistant'
  readonly content: Array<Block>
}

/**
 * Schema for the Anthropic-specific options carried on prompt parts/messages.
 * Decoded via `Schema` rather than ad-hoc property probing.
 */
const AnthropicPartOptions = Schema.Struct({
  cacheControl: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        type: Schema.Literal('ephemeral'),
        ttl: Schema.optional(Schema.Literals(['5m', '1h'])),
      })
    )
  ),
  info: Schema.optional(
    Schema.NullOr(
      Schema.Union([
        Schema.Struct({
          type: Schema.Literal('thinking'),
          signature: Schema.String,
        }),
        Schema.Struct({
          type: Schema.Literal('redacted_thinking'),
          redactedData: Schema.String,
        }),
      ])
    )
  ),
})
const decodeAnthropicOptions = Schema.decodeUnknownOption(AnthropicPartOptions)

const anthropicOptions = (
  options: Prompt.ProviderOptions | undefined
): typeof AnthropicPartOptions.Type | undefined =>
  Option.getOrUndefined(decodeAnthropicOptions(options?.anthropic))

const explicitCacheHint = (
  options: Prompt.ProviderOptions | undefined
): CacheControl | undefined => {
  const cc = anthropicOptions(options)?.cacheControl
  if (cc == null) return undefined
  return cc.ttl === '1h'
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' }
}

const ephemeral = (ttl: '5m' | '1h'): CacheControl =>
  ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }

/** Shared budget tracking the 4-breakpoint cap, in invalidation order. */
interface CacheBudget {
  remaining: number
  dropped: number
}

/** Attach `cache_control` to a block if budget remains and it is not already set. */
const applyCache = (
  budget: CacheBudget,
  block: Block,
  control: CacheControl
): void => {
  if ('cache_control' in block) return
  if (budget.remaining <= 0) {
    budget.dropped += 1
    return
  }
  budget.remaining -= 1
  block.cache_control = control
}

// =============================================================================
// Prompt -> Anthropic request translation
// =============================================================================

const reasoningSignature = (part: Prompt.ReasoningPart): string | undefined => {
  const info = anthropicOptions(part.options)?.info
  return info != null && info.type === 'thinking' ? info.signature : undefined
}

/**
 * Translate a decoded `Prompt.Prompt` into Anthropic `system` + `messages`,
 * carrying explicit per-part cache hints alongside each emitted block.
 *
 * Adjacent same-role turns are merged because Anthropic requires strictly
 * alternating user/assistant turns and folds tool results into user turns.
 */
const translatePrompt = (
  prompt: Prompt.Prompt
): {
  readonly system: Array<Block>
  readonly messages: Array<WireMessage>
  readonly hints: Map<Block, CacheControl>
} => {
  const system: Array<Block> = []
  const messages: Array<WireMessage> = []
  const hints = new Map<Block, CacheControl>()

  const hint = (block: Block, control: CacheControl | undefined) => {
    if (control !== undefined) hints.set(block, control)
    return block
  }

  const push = (role: 'user' | 'assistant', block: Block) => {
    const last = messages[messages.length - 1]
    if (last !== undefined && last.role === role) {
      last.content.push(block)
    } else {
      messages.push({ role, content: [block] })
    }
  }

  for (const message of prompt.content) {
    switch (message.role) {
      case 'system': {
        system.push(
          hint(
            { type: 'text', text: message.content },
            explicitCacheHint(message.options)
          )
        )
        break
      }
      case 'user': {
        const messageHint = explicitCacheHint(message.options)
        message.content.forEach((part, index) => {
          const isLast = index === message.content.length - 1
          if (part.type === 'file' && part.mediaType.startsWith('image/')) {
            const data =
              typeof part.data === 'string' ? base64Data(part.data) : undefined
            if (data === undefined) return
            push(
              'user',
              hint(
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: part.mediaType,
                    data,
                  },
                },
                explicitCacheHint(part.options) ??
                  (isLast ? messageHint : undefined)
              )
            )
            return
          }
          if (part.type !== 'text') return
          push(
            'user',
            hint(
              { type: 'text', text: part.text },
              explicitCacheHint(part.options) ??
                (isLast ? messageHint : undefined)
            )
          )
        })
        break
      }
      case 'assistant': {
        for (const part of message.content) {
          switch (part.type) {
            case 'text':
              push(
                'assistant',
                hint(
                  { type: 'text', text: part.text },
                  explicitCacheHint(part.options)
                )
              )
              break
            case 'reasoning': {
              const signature = reasoningSignature(part)
              if (signature !== undefined) {
                // Thinking blocks must not carry cache_control.
                push('assistant', {
                  type: 'thinking',
                  thinking: part.text,
                  signature,
                })
              }
              break
            }
            case 'tool-call':
              push(
                'assistant',
                hint(
                  {
                    type: 'tool_use',
                    id: part.id,
                    name: part.name,
                    input: part.params,
                  },
                  explicitCacheHint(part.options)
                )
              )
              break
          }
        }
        break
      }
      case 'tool': {
        const messageHint = explicitCacheHint(message.options)
        message.content.forEach((part, index) => {
          if (part.type !== 'tool-result') return
          const isLast = index === message.content.length - 1
          push(
            'user',
            hint(
              {
                type: 'tool_result',
                tool_use_id: part.id,
                content: JSON.stringify(part.result),
                is_error: part.isFailure,
              },
              explicitCacheHint(part.options) ??
                (isLast ? messageHint : undefined)
            )
          )
        })
        break
      }
    }
  }

  return { system, messages, hints }
}

const translateTools = (
  tools: ReadonlyArray<Tool.Any>
): Array<Block> | undefined => {
  const userTools = tools.filter(
    (tool) => Tool.isUserDefined(tool) || Tool.isDynamic(tool)
  )
  if (userTools.length === 0) return undefined
  return userTools.map((tool) => {
    const description = Tool.getDescription(tool)
    return {
      name: tool.name,
      input_schema: Tool.getJsonSchema(tool),
      ...(description !== undefined ? { description } : {}),
    }
  })
}

const toolChoice = (
  choice: LanguageModel.ProviderOptions['toolChoice']
): Record<string, unknown> | undefined => {
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  if (choice === 'none') return { type: 'none' }
  if (typeof choice === 'object' && 'tool' in choice) {
    return { type: 'tool', name: choice.tool }
  }
  return undefined
}

const lastCacheableBlock = (content: Array<Block>): Block | undefined => {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    // Thinking blocks reject cache_control; skip them.
    if (block !== undefined && block.type !== 'thinking') return block
  }
  return undefined
}

/**
 * Place cache breakpoints within Anthropic's 4-marker cap.
 *
 * 1. Explicit caller hints first, in invalidation order (tools -> system ->
 *    messages) so the most reusable prefixes survive when the cap is tight.
 * 2. Then automatic breakpoints on the stable prefix (last tool, last system
 *    block) and a rolling window over the final messages.
 */
const applyCaching = (
  config: AnthropicConfig,
  tools: Array<Block> | undefined,
  system: Array<Block>,
  messages: Array<WireMessage>,
  hints: Map<Block, CacheControl>
): void => {
  const auto = config.cache?.enabled ?? true
  const ttl = ephemeral(config.cache?.ttl ?? '5m')
  const budget: CacheBudget = { remaining: CACHE_BREAKPOINT_CAP, dropped: 0 }

  const allBlocks: Array<Block> = [
    ...(tools ?? []),
    ...system,
    ...messages.flatMap((m) => m.content),
  ]

  // Phase 1: explicit hints, in document/invalidation order.
  for (const block of allBlocks) {
    const explicit = hints.get(block)
    if (explicit !== undefined) applyCache(budget, block, explicit)
  }

  if (!auto) return

  // Phase 2: automatic stable-prefix + rolling-window breakpoints.
  const lastTool = tools?.at(-1)
  if (lastTool !== undefined) applyCache(budget, lastTool, ttl)
  const lastSystem = system.at(-1)
  if (lastSystem !== undefined) applyCache(budget, lastSystem, ttl)
  const rolling = messages.slice(-ROLLING_CACHE_MESSAGES)
  for (const message of rolling) {
    const block = lastCacheableBlock(message.content)
    if (block !== undefined) applyCache(budget, block, ttl)
  }
}

/**
 * Build the extended-thinking request fragment.
 *
 * Returns the `thinking` block, an optional `output_config` (adaptive effort),
 * and a floor for `max_tokens` (Anthropic requires `max_tokens > budget_tokens`).
 * When thinking is active, `temperature` must be omitted.
 */
const buildThinking = (
  thinking: AnthropicThinking | undefined
): {
  readonly thinking?: Record<string, unknown>
  readonly output_config?: Record<string, unknown>
  readonly minMaxTokens: number
  readonly active: boolean
} => {
  if (thinking === undefined) return { minMaxTokens: 0, active: false }
  if (thinking.type === 'enabled') {
    return {
      thinking: { type: 'enabled', budget_tokens: thinking.budgetTokens },
      minMaxTokens: thinking.budgetTokens + 1,
      active: true,
    }
  }
  return {
    thinking: { type: 'adaptive' },
    ...(thinking.effort !== undefined
      ? { output_config: { effort: thinking.effort } }
      : {}),
    minMaxTokens: 0,
    active: true,
  }
}

const buildPayload = (
  config: AnthropicConfig,
  options: LanguageModel.ProviderOptions,
  stream: boolean
): Record<string, unknown> => {
  const { system, messages, hints } = translatePrompt(options.prompt)
  const tools = translateTools(options.tools)
  const choice = toolChoice(options.toolChoice)
  const thinking = buildThinking(config.thinking)

  applyCaching(config, tools, system, messages, hints)

  const baseMaxTokens = config.maxTokens ?? config.capabilities.maxOutputTokens
  const maxTokens = Math.max(baseMaxTokens, thinking.minMaxTokens)

  return {
    model: config.model,
    max_tokens: maxTokens,
    stream,
    messages,
    ...(system.length > 0 ? { system } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(choice !== undefined ? { tool_choice: choice } : {}),
    ...(thinking.thinking !== undefined ? { thinking: thinking.thinking } : {}),
    ...(thinking.output_config !== undefined
      ? { output_config: thinking.output_config }
      : {}),
    ...(config.fast === true ? { speed: 'fast' } : {}),
  }
}

// =============================================================================
// Finish reason + usage mapping
// =============================================================================

/** Anthropic `stop_reason` -> effect's `Response.FinishReason` domain union. */
const FINISH_REASONS: Record<string, Response.FinishReason> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool-calls',
  refusal: 'content-filter',
}

const finishReason = (raw: string | null | undefined): Response.FinishReason =>
  raw == null ? 'unknown' : (FINISH_REASONS[raw] ?? 'other')

const usageEncoded = (
  usage: typeof Usage.Type
): Response.FinishPartEncoded['usage'] => {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const uncached = usage.input_tokens ?? 0
  return {
    inputTokens: {
      uncached,
      total: uncached + cacheRead + cacheWrite,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: usage.output_tokens ?? 0,
      text: undefined,
      reasoning: undefined,
    },
  }
}

// =============================================================================
// HTTP
// =============================================================================

const sendMessages = (
  client: HttpClient.HttpClient,
  config: AnthropicConfig,
  options: LanguageModel.ProviderOptions,
  stream: boolean
) =>
  HttpClientRequest.post('/v1/messages').pipe(
    HttpClientRequest.prependUrl(config.apiUrl ?? DEFAULT_API_URL),
    HttpClientRequest.setHeaders({
      'x-api-key': config.apiKey,
      'anthropic-version': config.anthropicVersion ?? DEFAULT_VERSION,
      ...(config.fast === true ? { 'anthropic-beta': FAST_MODE_BETA } : {}),
    }),
    HttpClientRequest.bodyJsonUnsafe(buildPayload(config, options, stream)),
    client.execute,
    Effect.flatMap(ensureOk('anthropic', 'AnthropicMessages', 'postMessages')),
    Effect.mapError((cause) =>
      AiError.isAiError(cause) ? cause : new AnthropicTransportError({ cause })
    )
  )

/**
 * Issue a Messages request, transparently falling back to standard speed when
 * fast mode is rate limited.
 *
 * Fast mode has a small dedicated rate-limit pool separate from standard Opus;
 * exhausting it returns a 429 even for tiny prompts. Per Anthropic's guidance,
 * the right response is to retry the request without `speed: "fast"` rather
 * than wait on the fast pool. We make a single fast attempt, then fall back to
 * the standard-speed request (which carries the normal retry/backoff schedule).
 */
const postMessages = (
  client: HttpClient.HttpClient,
  config: AnthropicConfig,
  options: LanguageModel.ProviderOptions,
  stream: boolean
) => {
  const standard = retryProviderRequest(
    sendMessages(client, { ...config, fast: false }, options, stream),
    config.onRetry
  )

  if (config.fast !== true) return standard

  // One fast attempt; on a fast-mode rate limit, drop to standard speed.
  return sendMessages(client, config, options, stream).pipe(
    Effect.catchIf(isRateLimitError, () => standard)
  )
}

const isRateLimitError = (error: unknown): boolean =>
  AiError.isAiError(error) && error.reason._tag === 'RateLimitError'

// =============================================================================
// Streaming hook
// =============================================================================

type BlockState =
  | { readonly kind: 'text' }
  | { readonly kind: 'reasoning' }
  | {
      readonly kind: 'tool-call'
      readonly id: string
      readonly name: string
      params: string
    }

const streamHook =
  (client: HttpClient.HttpClient, config: AnthropicConfig) =>
  (options: LanguageModel.ProviderOptions) => {
    const build = Effect.gen(function* () {
      const response = yield* postMessages(client, config, options, true)
      const timestamp = DateTime.formatIso(yield* DateTime.now)
      const request = {
        method: response.request.method,
        url: response.request.url,
        urlParams: Array.from(response.request.urlParams),
        hash: Option.getOrUndefined(response.request.hash),
        headers: { ...response.request.headers },
      } as const
      const blocks = new Map<number, BlockState>()
      let pendingFinish: Response.FinishReason = 'unknown'
      let pendingUsage: typeof Usage.Type = {}
      let messageStopped = false

      return response.stream.pipe(
        Stream.decodeText(),
        Stream.pipeThroughChannel(Sse.decodeDataSchema(StreamEvent)),
        Stream.map((event) => event.data),
        Stream.takeUntil((event) => event.type === 'message_stop'),
        Stream.map((event): ReadonlyArray<Response.StreamPartEncoded> => {
          switch (event.type) {
            case 'message_start':
              pendingUsage = event.message.usage
              return [
                {
                  type: 'response-metadata',
                  id: event.message.id,
                  modelId: event.message.model,
                  timestamp,
                  request,
                },
              ]

            case 'content_block_start': {
              const block = event.content_block
              const id = event.index.toString()
              if (block.type === 'text') {
                blocks.set(event.index, { kind: 'text' })
                return [{ type: 'text-start', id }]
              }
              if (block.type === 'thinking') {
                blocks.set(event.index, { kind: 'reasoning' })
                return [{ type: 'reasoning-start', id }]
              }
              blocks.set(event.index, {
                kind: 'tool-call',
                id: block.id,
                name: block.name,
                params: '',
              })
              return [
                { type: 'tool-params-start', id: block.id, name: block.name },
              ]
            }

            case 'content_block_delta': {
              const id = event.index.toString()
              const delta = event.delta
              if (delta.type === 'text_delta') {
                return [{ type: 'text-delta', id, delta: delta.text }]
              }
              if (delta.type === 'thinking_delta') {
                return [{ type: 'reasoning-delta', id, delta: delta.thinking }]
              }
              if (delta.type === 'signature_delta') {
                return [
                  {
                    type: 'reasoning-delta',
                    id,
                    delta: '',
                    metadata: {
                      anthropic: {
                        info: { type: 'thinking', signature: delta.signature },
                      },
                    },
                  },
                ]
              }
              // input_json_delta
              const block = blocks.get(event.index)
              if (
                block?.kind !== 'tool-call' ||
                delta.partial_json.length === 0
              ) {
                return []
              }
              block.params += delta.partial_json
              return [
                {
                  type: 'tool-params-delta',
                  id: block.id,
                  delta: delta.partial_json,
                },
              ]
            }

            case 'content_block_stop': {
              const block = blocks.get(event.index)
              blocks.delete(event.index)
              const id = event.index.toString()
              if (block?.kind === 'text') return [{ type: 'text-end', id }]
              if (block?.kind === 'reasoning') {
                return [{ type: 'reasoning-end', id }]
              }
              if (block?.kind === 'tool-call') {
                const raw = block.params.length === 0 ? '{}' : block.params
                return [
                  { type: 'tool-params-end', id: block.id },
                  {
                    type: 'tool-call',
                    id: block.id,
                    name: block.name,
                    params: Tool.unsafeSecureJsonParse(raw),
                  },
                ]
              }
              return []
            }

            case 'message_delta':
              pendingFinish = finishReason(event.delta.stop_reason)
              pendingUsage = { ...pendingUsage, ...event.usage }
              return []

            case 'error':
              return [{ type: 'error', error: event.error }]

            case 'ping':
              return []

            case 'message_stop':
              messageStopped = true
              return []
          }
        }),
        Stream.flattenIterable,
        // A transport EOF is only a successful completion after Anthropic's
        // explicit message_stop sentinel has been observed.
        (self) =>
          Stream.concat(
            self,
            Stream.fromEffect(
              Effect.suspend(() =>
                messageStopped
                  ? Effect.succeed<Response.StreamPartEncoded>({
                      type: 'finish',
                      reason: pendingFinish,
                      usage: usageEncoded(pendingUsage),
                      response: undefined,
                    })
                  : Effect.fail(
                      AiError.make({
                        module: 'AnthropicMessages',
                        method: 'streamText',
                        reason: new AiError.InternalProviderError({
                          description:
                            'Anthropic stream ended before message_stop',
                        }),
                      })
                    )
              )
            )
          )
      )
    })

    return build.pipe(Stream.unwrap, Stream.mapError(toAiError('streamText')))
  }

// =============================================================================
// Non-streaming hook
// =============================================================================

const generateHook =
  (client: HttpClient.HttpClient, config: AnthropicConfig) =>
  (options: LanguageModel.ProviderOptions) =>
    Effect.gen(function* () {
      const response = yield* postMessages(client, config, options, false)
      const message = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MessageResponse))
      )

      const parts: Array<Response.PartEncoded> = []
      for (const block of message.content) {
        if (block.type === 'text') {
          parts.push({ type: 'text', text: block.text })
        } else if (block.type === 'thinking') {
          parts.push({
            type: 'reasoning',
            text: block.thinking,
            ...(block.signature !== undefined
              ? {
                  options: {
                    anthropic: {
                      info: { type: 'thinking', signature: block.signature },
                    },
                  },
                }
              : {}),
          })
        } else {
          parts.push({
            type: 'tool-call',
            id: block.id,
            name: block.name,
            params: block.input,
          })
        }
      }

      parts.push({
        type: 'finish',
        reason: finishReason(message.stop_reason),
        usage: usageEncoded(message.usage),
        response: undefined,
      })

      return parts
    }).pipe(Effect.mapError(toAiError('generateText')))

// =============================================================================
// Public API
// =============================================================================

/** Build a `LanguageModel.Service` from an Anthropic config. */
export const make = (config: AnthropicConfig) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* LanguageModel.make({
      generateText: generateHook(client, config),
      streamText: streamHook(client, config),
    })
  })

/** Layer providing `LanguageModel.LanguageModel`, requiring an `HttpClient`. */
export const layer = (
  config: AnthropicConfig
): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> =>
  Layer.effect(LanguageModel.LanguageModel, make(config))
