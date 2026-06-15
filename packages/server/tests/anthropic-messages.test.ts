/**
 * Validates the hand-rolled Anthropic Messages `LanguageModel` seam.
 *
 * No real network: a stub `HttpClient` replays a canned Anthropic SSE stream.
 * The point is to prove that
 *   - an *arbitrary, unknown* model id flows through with no validation gate, and
 *   - Anthropic SSE maps cleanly onto effect's `Response.StreamPart` protocol.
 */
import { Effect, Layer, Schema, Stream } from 'effect'
import { LanguageModel, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'
import { describe, expect, it } from '@effect/vitest'
import { layer as anthropicLayer } from '../src/providers/anthropic-messages.ts'

// A tool whose name + parameter schema match the canned tool call below.
const Bash = Tool.make('Bash', {
  description: 'Run a shell command',
  parameters: Schema.Struct({ command: Schema.String }),
  success: Schema.String,
})
const toolkit = Toolkit.make(Bash)
const ToolkitLayer = toolkit.toLayer({ Bash: () => Effect.succeed('ok') })

// A canned Anthropic Messages SSE stream: text delta + one tool call.
const CANNED_SSE = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_123","model":"claude-fictional","usage":{"input_tokens":42}}}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash"}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"ls\\"}"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":1}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15}}`,
  ``,
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  ``,
].join('\n')

type Captured = {
  value: unknown
  headers: Readonly<Record<string, string>>
}

const stubHttpClient = (captured: Captured) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      // Capture the outgoing request body + headers to assert the translation.
      if (request.body._tag === 'Uint8Array') {
        captured.value = JSON.parse(new TextDecoder().decode(request.body.body))
      }
      captured.headers = request.headers
      return HttpClientResponse.fromWeb(
        request,
        new globalThis.Response(CANNED_SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      )
    })
  )

type Body = Record<string, unknown>

interface RunOptions {
  readonly model?: string
  readonly prompt?: Parameters<typeof LanguageModel.streamText>[0]['prompt']
  readonly config?: Partial<Parameters<typeof anthropicLayer>[0]>
}

const run = (opts: RunOptions = {}) =>
  Effect.gen(function* () {
    const captured: Captured = { value: undefined, headers: {} }
    const stream = LanguageModel.streamText({
      prompt: opts.prompt ?? 'Say hello and list files',
      toolkit,
    })
    const parts = yield* Stream.runCollect(stream).pipe(
      Effect.provide(
        Layer.mergeAll(
          anthropicLayer({
            model: opts.model ?? 'claude-sonnet-9-vaporware-20991231',
            apiKey: 'test-key',
            capabilities: { maxOutputTokens: 64000 },
            ...opts.config,
          }).pipe(
            Layer.provide(
              Layer.succeed(HttpClient.HttpClient, stubHttpClient(captured))
            )
          ),
          ToolkitLayer
        )
      )
    )
    return { parts, body: captured.value as Body, headers: captured.headers }
  })

// Count cache_control markers across tools, system, and message blocks.
const countCacheMarkers = (body: Body): number => {
  const blocks: Array<Record<string, unknown>> = []
  const tools = body.tools
  if (Array.isArray(tools)) blocks.push(...tools)
  const system = body.system
  if (Array.isArray(system)) blocks.push(...system)
  const messages = body.messages
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const content = (message as { content?: unknown }).content
      if (Array.isArray(content)) blocks.push(...content)
    }
  }
  return blocks.filter((b) => 'cache_control' in b).length
}

const richPrompt: Parameters<typeof LanguageModel.streamText>[0]['prompt'] = [
  { role: 'system', content: 'You are a careful coding assistant.' },
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: 'second answer' },
  { role: 'user', content: 'third question' },
]

describe('AnthropicMessages LanguageModel seam', () => {
  it.effect('streams text + tool call for an arbitrary unknown model id', () =>
    Effect.gen(function* () {
      // A model id effect/ai-anthropic has never heard of — no gate rejects it.
      const { parts, body } = yield* run({
        model: 'claude-sonnet-9-vaporware-20991231',
      })

      const types = parts.map((p) => p.type)
      expect(types).toContain('text-delta')
      expect(types).toContain('tool-call')
      expect(types).toContain('finish')

      const text = parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => p.delta)
        .join('')
      expect(text).toBe('Hello world')

      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall?.name).toBe('Bash')
      expect(toolCall?.params).toEqual({ command: 'ls' })

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish?.reason).toBe('tool-calls')
      expect(finish?.usage.inputTokens.uncached).toBe(42)
      expect(finish?.usage.outputTokens.total).toBe(15)

      // The arbitrary model id is forwarded verbatim to the wire.
      expect(body.model).toBe('claude-sonnet-9-vaporware-20991231')
    })
  )

  it.effect('caches the stable prefix and a rolling message window', () =>
    Effect.gen(function* () {
      const { body } = yield* run({ prompt: richPrompt })

      // System is lowered to a block array with a cache breakpoint on the tail.
      const system = body.system as Array<Record<string, unknown>>
      expect(Array.isArray(system)).toBe(true)
      expect(system.at(-1)).toHaveProperty('cache_control', {
        type: 'ephemeral',
      })

      // The last tool definition carries a cache breakpoint.
      const tools = body.tools as Array<Record<string, unknown>>
      expect(tools.at(-1)).toHaveProperty('cache_control')

      // Rolling window: the final two messages' tail blocks are cached.
      const messages = body.messages as Array<{
        content: Array<Record<string, unknown>>
      }>
      expect(messages.at(-1)?.content.at(-1)).toHaveProperty('cache_control')
      expect(messages.at(-2)?.content.at(-1)).toHaveProperty('cache_control')

      // Never exceed Anthropic's hard cap of 4 breakpoints.
      expect(countCacheMarkers(body)).toBeLessThanOrEqual(4)
    })
  )

  it.effect('places no cache breakpoints when caching is disabled', () =>
    Effect.gen(function* () {
      const { body } = yield* run({
        prompt: richPrompt,
        config: { cache: { enabled: false } },
      })
      expect(countCacheMarkers(body)).toBe(0)
    })
  )

  it.effect('emits token-budget thinking config', () =>
    Effect.gen(function* () {
      const { body } = yield* run({
        config: {
          thinking: { type: 'enabled', budgetTokens: 10000 },
          maxTokens: 4096,
        },
      })
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 })
      // max_tokens must exceed the thinking budget.
      expect(body.max_tokens as number).toBeGreaterThan(10000)
    })
  )

  it.effect('emits adaptive thinking config with effort', () =>
    Effect.gen(function* () {
      const { body } = yield* run({
        config: { thinking: { type: 'adaptive', effort: 'high' } },
      })
      expect(body.thinking).toEqual({ type: 'adaptive' })
      expect(body.output_config).toEqual({ effort: 'high' })
    })
  )

  it.effect('emits fast mode: speed body field + beta header', () =>
    Effect.gen(function* () {
      const { body, headers } = yield* run({ config: { fast: true } })
      expect(body.speed).toBe('fast')
      expect(headers['anthropic-beta']).toBe('fast-mode-2026-02-01')
    })
  )

  it.effect('omits fast mode by default', () =>
    Effect.gen(function* () {
      const { body, headers } = yield* run()
      expect(body).not.toHaveProperty('speed')
      expect(headers).not.toHaveProperty('anthropic-beta')
    })
  )

  it.effect('falls back to standard speed when fast mode is rate limited', () =>
    Effect.gen(function* () {
      const attempts: Array<{
        readonly body: Body
        readonly headers: Readonly<Record<string, string>>
      }> = []

      // Reject the fast attempt with a 429, accept the standard retry.
      const stub = HttpClient.make((request) =>
        Effect.sync(() => {
          const body =
            request.body._tag === 'Uint8Array'
              ? (JSON.parse(
                  new TextDecoder().decode(request.body.body)
                ) as Body)
              : ({} as Body)
          attempts.push({ body, headers: request.headers })

          if (body.speed === 'fast') {
            return HttpClientResponse.fromWeb(
              request,
              new globalThis.Response(
                JSON.stringify({
                  type: 'error',
                  error: { type: 'rate_limit_error', message: 'slow down' },
                }),
                {
                  status: 429,
                  headers: { 'content-type': 'application/json' },
                }
              )
            )
          }

          return HttpClientResponse.fromWeb(
            request,
            new globalThis.Response(CANNED_SSE, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            })
          )
        })
      )

      const parts = yield* Stream.runCollect(
        LanguageModel.streamText({ prompt: 'hi', toolkit })
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            anthropicLayer({
              model: 'claude-opus-4-8',
              apiKey: 'test-key',
              capabilities: { maxOutputTokens: 64000 },
              fast: true,
            }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, stub))),
            ToolkitLayer
          )
        )
      )

      // The run completes (no failure) by retrying without fast mode.
      expect(parts.map((p) => p.type)).toContain('finish')

      // First attempt was fast; the fallback dropped speed + beta header.
      expect(attempts.length).toBe(2)
      expect(attempts[0]?.body.speed).toBe('fast')
      expect(attempts[0]?.headers['anthropic-beta']).toBe(
        'fast-mode-2026-02-01'
      )
      expect(attempts[1]?.body).not.toHaveProperty('speed')
      expect(attempts[1]?.headers).not.toHaveProperty('anthropic-beta')
    })
  )
})
