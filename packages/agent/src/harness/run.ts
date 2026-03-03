/**
 * Run a complete agent loop, continuing from an existing conversation.
 *
 * The caller builds the conversation (system prompt, user messages, prior
 * turns) and passes it in. `run()` seeds a `Chat` with it, calls
 * `streamText` in a loop until no tool calls remain, and returns the
 * full conversation + accumulated text.
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

/**
 * Continue an agent conversation from where it left off.
 *
 * @param conversation - The full conversation so far (system prompt + all
 *   prior messages + the latest user message). The model will respond to
 *   whatever the conversation ends with.
 * @param config - Toolkit and hooks. `systemPrompt` on config is ignored
 *   here — it exists for callers like `test()` that build conversations.
 */
export const run = <
  Tools extends Record<string, Tool.Any>,
  HookE = never,
  HookR = never,
>(
  conversation: Prompt.Prompt,
  config: HarnessConfig<Tools, HookE, HookR>
): Effect_.Effect<
  HarnessResult,
  AiError.AiError | HookE,
  LanguageModel_.LanguageModel | HookR
> =>
  Effect_.gen(function* () {
    const chat = yield* Chat_.fromPrompt(conversation)

    const fireHooks = (event: HarnessEvent) =>
      Effect_.gen(function* () {
        if (config.hooks) {
          for (const hook of config.hooks) {
            yield* hook.handle(event)
          }
        }
      })

    yield* fireHooks({ _tag: 'RunStart' })

    // Accumulate text and usage across all turns
    let outputText = ''
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    // First turn: empty prompt — the conversation already ends with the
    // user's message, so Chat.streamText sends it as-is to the model.
    // Subsequent turns also use empty (tool results are already in Chat).
    let prompt: Prompt.RawInput = [] as Array<Prompt.MessageEncoded>

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
      output: outputText,
      usage,
    })

    const fullConversation = yield* Ref_.get(chat.history)

    return {
      conversation: fullConversation,
      text: outputText,
      usage,
    } satisfies HarnessResult
  })
