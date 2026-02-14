/**
 * Run a complete agent loop for a single scenario input.
 *
 * Uses `streamText` in a loop — each iteration sends the conversation to
 * the model, streams the response, and resolves any tool calls. The loop
 * continues until a turn produces no tool calls (the model is "done").
 *
 * `@effect/ai`'s `Chat` maintains conversation history across calls, so
 * tool results from one turn are visible to the model in the next.
 *
 * Hooks fire on every stream part — text deltas, tool calls, tool results.
 */
import type { AiError, Prompt, Response, Tool } from '@effect/ai'
import type { HarnessConfig, HarnessEvent, HarnessResult } from './harness.ts'

import { Effect as Effect_, Ref as Ref_, Stream as Stream_ } from 'effect'
import { LanguageModel as LanguageModel_, Chat as Chat_ } from '@effect/ai'

/** Maximum agent loop iterations to prevent runaway tool-call cycles. */
const MAX_TURNS = 25

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

    // Accumulate text and usage across all turns
    let outputText = ''
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    // The first turn uses the user's input as the prompt.
    // Subsequent turns pass an empty message array — Chat.streamText merges
    // this with the existing history (which already contains tool results),
    // and the empty array is a no-op in Prompt.merge.
    let prompt: Prompt.RawInput = input

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let hadToolCalls = false

      const stream = chat.streamText({
        prompt,
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
              hadToolCalls = true
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

      // If no tool calls this turn, the model is done
      if (!hadToolCalls) break

      // Empty array merges as no-op with existing Chat history
      prompt = [] as Array<Prompt.MessageEncoded>
    }

    yield* fireHooks({
      _tag: 'RunEnd',
      input,
      output: outputText,
      usage,
    })

    const conversation = yield* Ref_.get(chat.history)

    return { conversation, usage } satisfies HarnessResult
  })
