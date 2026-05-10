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
 * Hooks fire on every stream part — text deltas, reasoning deltas, tool calls,
 * tool results.
 *
 * On interruption (e.g. user hitting stop), the agent loop runs inside
 * `Effect.uninterruptibleMask` with the loop itself restored to
 * interruptible. When interrupted, `Effect.exit` captures the
 * interruption as a value, and the cleanup phase (RunEnd hook +
 * history read + partial text recovery) runs uninterruptibly.
 *
 * Partial text recovery: @effect/ai's `Prompt.fromResponseParts` only
 * flushes text on `text-end`, which never fires when a stream is
 * interrupted. The harness tracks per-turn text and appends a synthetic
 * assistant message for any un-flushed content on interrupt.
 */
import type { AiError, Response, Tool } from 'effect/unstable/ai'
import type { Effect as EffectType } from 'effect/Effect'
import type { LanguageModel } from 'effect/unstable/ai'
import type { HarnessConfig, HarnessEvent, HarnessResult } from './harness.ts'

import { Cause, Effect, Exit, Match, Ref, Stream } from 'effect'
import { Chat, Prompt } from 'effect/unstable/ai'

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
): EffectType<
  HarnessResult,
  AiError.AiError | HookE,
  LanguageModel.LanguageModel | HookR
> =>
  Effect.gen(function* () {
    const chat = yield* Chat.fromPrompt(conversation)

    const fireHooks = Effect.fn('Harness.fireHooks')(function* (
      event: HarnessEvent
    ) {
      if (config.hooks) {
        for (const hook of config.hooks) {
          yield* hook.handle(event)
        }
      }
    })

    // Accumulate text and usage across all turns
    let outputText = ''
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    // Text accumulated in the CURRENT turn only. Reset at the start of
    // each turn. Used to recover partial text on interrupt — @effect/ai's
    // Prompt.fromResponseParts only flushes text on `text-end`, which
    // never fires when the stream is interrupted mid-text.
    let currentTurnText = ''

    const runTurn = Effect.fn('Harness.runTurn')(function* (
      turn: number,
      prompt: Prompt.RawInput
    ) {
      let hadToolCalls = false
      currentTurnText = ''
      yield* Effect.logDebug('Harness turn starting', { turn })

      const stream = chat.streamText({
        prompt,
        toolkit: config.toolkit,
      })

      yield* Stream.runForEach(stream, (part: Response.StreamPart<Tools>) =>
        // oxlint-disable-next-line sorato/no-nested-effect-gen -- keeping the streamed part handling in one generator preserves precise narrowing
        Effect.gen(function* () {
          switch (part.type) {
            case 'text-delta': {
              outputText += part.delta
              currentTurnText += part.delta
              yield* fireHooks({
                _tag: 'TextDelta',
                delta: part.delta,
              })
              break
            }
            case 'reasoning-delta': {
              yield* fireHooks({
                _tag: 'ReasoningDelta',
                delta: part.delta,
              })
              break
            }
            case 'tool-call': {
              hadToolCalls = true
              yield* Effect.logInfo('Harness tool call received', {
                turn,
                toolCallId: part.id,
                toolName: part.name,
              })
              yield* fireHooks({
                _tag: 'ToolCall',
                id: part.id,
                name: part.name,
                params: part.params,
              })
              break
            }
            case 'tool-result': {
              const logToolResult = Match.value(part.isFailure).pipe(
                Match.when(true, () => Effect.logWarning),
                Match.orElse(() => Effect.logDebug)
              )
              yield* logToolResult('Harness tool result received', {
                turn,
                toolCallId: part.id,
                toolName: part.name,
                isFailure: part.isFailure,
              })
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
              // Turn completed normally — clear currentTurnText so the
              // interrupt path knows there's nothing to recover.
              currentTurnText = ''
              const inputTokens = part.usage.inputTokens.total ?? 0
              const outputTokens = part.usage.outputTokens.total ?? 0
              usage.inputTokens += inputTokens
              usage.outputTokens += outputTokens
              usage.totalTokens += inputTokens + outputTokens
              yield* Effect.logDebug('Harness turn finished', {
                turn,
                inputTokens,
                outputTokens,
              })
              break
            }
          }
        })
      )

      return hadToolCalls
    })

    yield* fireHooks({ _tag: 'RunStart' })

    // The agent loop runs interruptibly so the user can stop it mid-
    // stream. But cleanup (RunEnd hook, reading history, returning the
    // result) MUST run even after interrupt — otherwise callers can't
    // persist partial content.
    //
    // uninterruptibleMask gives us both: `restore` re-enables interrupts
    // for the inner loop, while everything after Effect.exit runs in
    // the uninterruptible outer region.
    return yield* Effect.uninterruptibleMask((restore) =>
      // oxlint-disable-next-line sorato/no-nested-effect-gen -- cleanup and recovery need one outer uninterruptible generator around the interruptible loop
      Effect.gen(function* () {
        yield* Effect.logInfo('Harness run starting', {
          messageCount: conversation.content.length,
          hookCount: config.hooks?.length ?? 0,
          hasToolkit: config.toolkit !== undefined,
        })

        const exit = yield* Effect.exit(
          restore(
            // oxlint-disable-next-line sorato/no-nested-effect-gen -- @effect/ai stream typing stays stable with the loop kept in one generator
            Effect.gen(function* () {
              // First turn: empty prompt — the conversation already
              // ends with the user's message, so Chat.streamText sends
              // it as-is. Subsequent turns also use empty (tool results
              // are in Chat).
              let prompt: Prompt.RawInput = [] as Array<Prompt.MessageEncoded>

              for (let turn = 0; turn < MAX_TURNS; turn++) {
                const hadToolCalls = yield* runTurn(turn, prompt)

                if (!hadToolCalls) break
                yield* Effect.logDebug(
                  'Harness turn requested tool follow-up',
                  {
                    turn,
                  }
                )

                // Turn completed — reset for next turn
                currentTurnText = ''
                prompt = [] as Array<Prompt.MessageEncoded>
              }
            })
          )
        )

        // Uninterruptible from here: fire RunEnd, read history, and
        // return the result — guaranteed to complete even after interrupt.
        yield* fireHooks({
          _tag: 'RunEnd',
          output: outputText,
          usage,
        })

        let fullConversation = yield* Ref.get(chat.history)

        // On interrupt, @effect/ai's Prompt.fromResponseParts drops
        // in-flight text (it only flushes on `text-end`, which never
        // arrives). If there's partial text from the interrupted turn,
        // append a synthetic assistant message so it gets persisted.
        const wasInterrupted =
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

        if (wasInterrupted && currentTurnText.length > 0) {
          yield* Effect.logInfo('Harness recovering interrupted text', {
            recoveredLength: currentTurnText.length,
          })
          fullConversation = Prompt.fromMessages([
            ...fullConversation.content,
            {
              ...Prompt.makeMessage('assistant', {
                content: [Prompt.makePart('text', { text: currentTurnText })],
              }),
            },
          ])
        }

        // Re-surface real failures so the caller's error channel is
        // preserved. Interrupts are swallowed — the partial result IS
        // the return value.
        if (Exit.isFailure(exit) && !wasInterrupted) {
          yield* Effect.logError('Harness run failed', {
            cause: Cause.pretty(exit.cause),
          })
          return yield* Effect.failCause(exit.cause)
        }

        const result = {
          conversation: fullConversation,
          text: outputText,
          usage,
        } satisfies HarnessResult

        // Fire RunResult inside the uninterruptible region so hooks
        // (e.g. persistence) are guaranteed to run even on interrupt.
        yield* fireHooks({
          _tag: 'RunResult',
          result,
          interrupted: wasInterrupted,
        })

        yield* Effect.logInfo('Harness run completed', {
          interrupted: wasInterrupted,
          outputLength: outputText.length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        })

        return result
      })
    )
  }).pipe(
    Effect.annotateLogs({ package: 'core', subsystem: 'harness' }),
    Effect.withLogSpan('harness.run')
  )
