/**
 * Run a complete agent loop for a single scenario input.
 *
 * Uses `streamText` to get real-time visibility into the agent loop.
 * Hooks fire on every stream part — text deltas, tool calls, tool results.
 * The full conversation is captured via the Chat history ref.
 */
import type { AiError, Response, Tool } from '@effect/ai'
import type { HarnessConfig, HarnessEvent, HarnessResult } from './Harness.ts'

import { Effect as Effect_, Ref as Ref_, Stream as Stream_ } from 'effect'
import { LanguageModel as LanguageModel_, Chat as Chat_ } from '@effect/ai'

export const run = <Tools extends Record<string, Tool.Any>, HookE, HookR>(
  input: string,
  config: HarnessConfig<Tools, HookE, HookR>
): Effect_.Effect<
  HarnessResult,
  AiError.AiError | HookE,
  LanguageModel_.LanguageModel | HookR
> =>
  Effect_.gen(function* () {
    const chat = yield* Chat_.fromPrompt(
      config.systemPrompt
        ? [{ role: 'system', content: config.systemPrompt }]
        : []
    )

    const fireHooks = (event: HarnessEvent) =>
      Effect_.gen(function* () {
        if (config.hooks) {
          for (const hook of config.hooks) {
            yield* hook.handle(event)
          }
        }
      })

    yield* fireHooks({ _tag: 'RunStart', input })

    // Accumulate text and usage as the stream progresses
    let outputText = ''
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    const stream = chat.streamText({
      prompt: input,
      toolkit: config.toolkit,
    })

    yield* Stream_.runForEach(stream, (part: Response.StreamPart<Tools>) =>
      Effect_.gen(function* () {
        switch (part.type) {
          case 'text-delta': {
            outputText += part.delta
            yield* fireHooks({ _tag: 'TextDelta', delta: part.delta })
            break
          }
          case 'tool-call': {
            yield* fireHooks({
              _tag: 'ToolCall',
              id: part.id,
              name: part.name,
              params: part.params,
            })
            break
          }
          case 'tool-result': {
            yield* fireHooks({
              _tag: 'ToolResult',
              id: part.id,
              name: part.name,
              result: part.result,
              isFailure: part.isFailure,
            })
            break
          }
          case 'finish': {
            usage.inputTokens += part.usage.inputTokens ?? 0
            usage.outputTokens += part.usage.outputTokens ?? 0
            usage.totalTokens += part.usage.totalTokens ?? 0
            break
          }
        }
      })
    )

    yield* fireHooks({
      _tag: 'RunEnd',
      input,
      output: outputText,
      usage,
    })

    const conversation = yield* Ref_.get(chat.history)

    return { conversation, usage } satisfies HarnessResult
  })
