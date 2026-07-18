/**
 * Validates the hand-rolled OpenAI Responses `LanguageModel` seam.
 *
 * No real network: a stub `HttpClient` replays a canned Responses SSE stream.
 * The point is to prove that
 *   - an *arbitrary, unknown* model id flows through with no validation gate,
 *   - the Responses streaming protocol maps cleanly onto effect's
 *     `Response.StreamPart` protocol (text, reasoning, tool calls, usage), and
 *   - the Codex transport shape (`store: false`, system hoisted to top-level
 *     `instructions`, encrypted reasoning round-tripping) is produced.
 */
import { Effect, Layer, Schema, Stream } from 'effect'
import { AiError, LanguageModel, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'
import { describe, expect, it } from '@effect/vitest'
import { layer as openAiLayer } from '../src/providers/openai-responses.ts'

const Bash = Tool.make('Bash', {
  description: 'Run a shell command',
  parameters: Schema.Struct({ command: Schema.String }),
  success: Schema.String,
})
const toolkit = Toolkit.make(Bash)
const ToolkitLayer = toolkit.toLayer({ Bash: () => Effect.succeed('ok') })

// A canned OpenAI Responses SSE stream: reasoning summary + text + one tool
// call, then completion with usage. Includes an unmodelled event type
// (`response.in_progress`) to prove unknown events are skipped, not fatal.
const CANNED_SSE = [
  `event: response.created`,
  `data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-fictional","created_at":1700000000}}`,
  ``,
  `event: response.in_progress`,
  `data: {"type":"response.in_progress","response":{"id":"resp_1"}}`,
  ``,
  `event: response.output_item.added`,
  `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_1","encrypted_content":"ENC"}}`,
  ``,
  `event: response.reasoning_summary_text.delta`,
  `data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":0,"delta":"thinking..."}`,
  ``,
  `event: response.output_item.done`,
  `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_1","encrypted_content":"ENC2"}}`,
  ``,
  `event: response.output_item.added`,
  `data: {"type":"response.output_item.added","output_index":1,"item":{"type":"message","id":"msg_1"}}`,
  ``,
  `event: response.output_text.delta`,
  `data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hello"}`,
  ``,
  `event: response.output_text.delta`,
  `data: {"type":"response.output_text.delta","item_id":"msg_1","delta":" world"}`,
  ``,
  `event: response.output_item.done`,
  `data: {"type":"response.output_item.done","output_index":1,"item":{"type":"message","id":"msg_1"}}`,
  ``,
  `event: response.output_item.added`,
  `data: {"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","id":"fc_item","call_id":"call_1","name":"Bash","arguments":""}}`,
  ``,
  `event: response.function_call_arguments.delta`,
  `data: {"type":"response.function_call_arguments.delta","output_index":2,"delta":"{\\"command\\":\\"ls\\"}"}`,
  ``,
  `event: response.function_call_arguments.done`,
  `data: {"type":"response.function_call_arguments.done","output_index":2,"item_id":"fc_item","arguments":"{\\"command\\":\\"ls\\"}"}`,
  ``,
  `event: response.completed`,
  `data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-fictional","usage":{"input_tokens":42,"output_tokens":15,"input_tokens_details":{"cached_tokens":10},"output_tokens_details":{"reasoning_tokens":5}},"service_tier":"flex"}}`,
  ``,
  ``,
].join('\n')

const stubHttpClient = (capturedBody: { value: unknown }, sse: string) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag === 'Uint8Array') {
        capturedBody.value = JSON.parse(
          new TextDecoder().decode(request.body.body)
        )
      }
      return HttpClientResponse.fromWeb(
        request,
        new globalThis.Response(sse, {
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
  readonly config?: Partial<Parameters<typeof openAiLayer>[0]>
  readonly sse?: string
}

const run = (opts: RunOptions = {}) =>
  Effect.gen(function* () {
    const captured = { value: undefined as unknown }
    const stream = LanguageModel.streamText({
      prompt: opts.prompt ?? 'Say hello and list files',
      toolkit,
    })
    const parts = yield* Stream.runCollect(stream).pipe(
      Effect.provide(
        Layer.mergeAll(
          openAiLayer({
            model: opts.model ?? 'gpt-9-vaporware-20991231',
            apiKey: 'test-key',
            ...opts.config,
          }).pipe(
            Layer.provide(
              Layer.succeed(
                HttpClient.HttpClient,
                stubHttpClient(captured, opts.sse ?? CANNED_SSE)
              )
            )
          ),
          ToolkitLayer
        )
      )
    )
    return { parts, body: captured.value as Body }
  })

describe('OpenAiResponses LanguageModel seam', () => {
  it.effect(
    'streams reasoning + text + tool call for an arbitrary unknown model id',
    () =>
      Effect.gen(function* () {
        const { parts, body } = yield* run({
          model: 'gpt-9-vaporware-20991231',
        })

        const types = parts.map((p) => p.type)
        expect(types).toContain('reasoning-delta')
        expect(types).toContain('text-delta')
        expect(types).toContain('tool-call')
        expect(types).toContain('finish')

        const reasoning = parts
          .filter((p) => p.type === 'reasoning-delta')
          .map((p) => p.delta)
          .join('')
        expect(reasoning).toBe('thinking...')

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
        expect(finish?.usage.inputTokens.total).toBe(42)
        expect(finish?.usage.inputTokens.cacheRead).toBe(10)
        expect(finish?.usage.outputTokens.total).toBe(15)
        expect(finish?.usage.outputTokens.reasoning).toBe(5)

        // The arbitrary model id is forwarded verbatim to the wire.
        expect(body.model).toBe('gpt-9-vaporware-20991231')
      })
  )

  it.effect('carries encrypted reasoning content into stream metadata', () =>
    Effect.gen(function* () {
      const { parts } = yield* run()
      const reasoningEnd = parts.find((p) => p.type === 'reasoning-end')
      // The final encrypted_content (ENC2) is surfaced so it can be round-tripped.
      expect(reasoningEnd?.metadata).toMatchObject({
        openai: { itemId: 'rs_1', encryptedContent: 'ENC2' },
      })
    })
  )

  it.effect('fails response.failed with the provider error payload', () =>
    Effect.gen(function* () {
      const error = yield* run({
        sse: [
          `event: response.failed`,
          `data: {"type":"response.failed","response":{"id":"resp_failed","error":{"code":"server_error","message":"Upstream model unavailable"}}}`,
          ``,
          ``,
        ].join('\n'),
      }).pipe(Effect.flip)

      expect(AiError.isAiError(error)).toBe(true)
      expect(error.message).toContain(
        'server_error: Upstream model unavailable'
      )
    })
  )

  it.effect('fails a malformed recognized terminal event', () =>
    Effect.gen(function* () {
      const error = yield* run({
        sse: [
          `event: response.completed`,
          `data: {"response":{"model":"gpt-fictional"}}`,
          ``,
          ``,
        ].join('\n'),
      }).pipe(Effect.flip)

      expect(AiError.isAiError(error)).toBe(true)
      expect(error.reason._tag).toBe('InvalidOutputError')
      expect(error.message).toContain(
        'Malformed response.completed terminal event'
      )
    })
  )

  it.effect('emits reasoning effort + summary config', () =>
    Effect.gen(function* () {
      const { body } = yield* run({
        config: { reasoning: { effort: 'high', summary: 'auto' } },
      })
      expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    })
  )

  it.effect('produces the Codex transport request shape', () =>
    Effect.gen(function* () {
      const { body } = yield* run({
        prompt: [
          { role: 'system', content: 'You are a careful coding assistant.' },
          { role: 'user', content: 'hi' },
        ],
        config: {
          store: false,
          systemAsInstructions: true,
          reasoning: { effort: 'medium', summary: 'auto' },
        },
      })

      // System prompt is hoisted to top-level instructions, not an input item.
      expect(body.instructions).toBe('You are a careful coding assistant.')
      expect(body.store).toBe(false)
      // store:false on a reasoning request asks for encrypted reasoning content.
      expect(body.include).toEqual(['reasoning.encrypted_content'])

      const input = body.input as Array<Record<string, unknown>>
      expect(input.some((item) => item.role === 'system')).toBe(false)
      expect(input.some((item) => item.role === 'user')).toBe(true)
    })
  )

  it.effect('omits store + include for the direct API key transport', () =>
    Effect.gen(function* () {
      const { body } = yield* run({
        config: { reasoning: { effort: 'low', summary: 'auto' } },
      })
      expect(body.store).toBeUndefined()
      expect(body.include).toBeUndefined()
      // System message (the default prompt has none) stays as input items.
      expect(body.instructions).toBeUndefined()
    })
  )
})
