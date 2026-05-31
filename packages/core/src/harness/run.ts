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
import type {
  MessageHeaderDisplay,
  ToolResultDisplay,
} from '../tool/tool-output.ts'

import { Cause, Effect, Exit, Ref, Stream } from 'effect'
import { Chat, Prompt } from 'effect/unstable/ai'
import { ToolOutputRegistry, toolCallDisplay } from '../tool/tool-output.ts'

/** Maximum agent loop iterations to prevent runaway tool-call cycles. */
const MAX_TURNS = 25

interface RunUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface RunState {
  outputText: string
  currentTurnParts: Array<Prompt.TextPart | Prompt.ReasoningPart>
  usage: RunUsage
}

const appendCurrentTurnPart = (
  state: RunState,
  type: 'text' | 'reasoning',
  delta: string
) => {
  const last = state.currentTurnParts[state.currentTurnParts.length - 1]
  if (last?.type === type) {
    state.currentTurnParts[state.currentTurnParts.length - 1] = Prompt.makePart(
      type,
      { text: last.text + delta }
    )
  } else {
    state.currentTurnParts.push(Prompt.makePart(type, { text: delta }))
  }
}

const fireHooks = <Tools extends Record<string, Tool.Any>, HookE, HookR>(
  config: HarnessConfig<Tools, HookE, HookR>,
  event: HarnessEvent
): EffectType<void, HookE, HookR> =>
  Effect.gen(function* () {
    if (config.hooks) {
      for (const hook of config.hooks) {
        yield* hook.handle(event)
      }
    }
  })

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
    const toolOutputRegistry = yield* ToolOutputRegistry
    const toolCallDisplays = new Map<
      string,
      {
        readonly display?: MessageHeaderDisplay | undefined
      }
    >()
    const toolResultDisplays = new Map<
      string,
      {
        readonly display?: ToolResultDisplay | undefined
      }
    >()

    const state: RunState = {
      outputText: '',
      currentTurnParts: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }

    // state.currentTurnParts is accumulated in the CURRENT turn only. Reset at
    // the start of each turn. Used to recover partial content on interrupt —
    // @effect/ai's Prompt.fromResponseParts only flushes text/reasoning on
    // their end parts, which never fire when the stream is interrupted mid-block.

    const runTurn = Effect.fn('Harness.runTurn')(function* (
      turn: number,
      prompt: Prompt.RawInput
    ) {
      let hadToolCalls = false
      state.currentTurnParts = []
      yield* Effect.logDebug('Harness turn starting', { turn })

      const stream = chat.streamText({
        prompt,
        toolkit: config.toolkit,
      })

      yield* Stream.runForEach(stream, (part: Response.StreamPart<Tools>) => {
        switch (part.type) {
          case 'text-delta':
            return Effect.sync(() => {
              state.outputText += part.delta
              appendCurrentTurnPart(state, 'text', part.delta)
            }).pipe(
              Effect.flatMap(() =>
                fireHooks(config, {
                  _tag: 'TextDelta',
                  delta: part.delta,
                })
              )
            )

          case 'reasoning-delta':
            return Effect.sync(() => {
              appendCurrentTurnPart(state, 'reasoning', part.delta)
            }).pipe(
              Effect.flatMap(() =>
                fireHooks(config, {
                  _tag: 'ReasoningDelta',
                  delta: part.delta,
                })
              )
            )

          case 'tool-call':
            const display = toolCallDisplay(part.name, part.params)
            return Effect.sync(() => {
              hadToolCalls = true
              toolCallDisplays.set(part.id, { display })
            }).pipe(
              Effect.flatMap(() =>
                Effect.logInfo('Harness tool call received', {
                  turn,
                  toolCallId: part.id,
                  toolName: part.name,
                })
              ),
              Effect.flatMap(() =>
                fireHooks(config, {
                  _tag: 'ToolCall',
                  id: part.id,
                  name: part.name,
                  params: part.params,
                  display,
                })
              )
            )

          case 'tool-result': {
            const logToolResult = part.isFailure
              ? Effect.logWarning
              : Effect.logDebug
            const resultText =
              typeof part.result === 'string'
                ? part.result
                : (JSON.stringify(part.result) ?? String(part.result))
            const presentation = toolOutputRegistry.take(part.name, resultText)
            if (presentation?.display) {
              toolResultDisplays.set(part.id, {
                display: presentation.display,
              })
            }
            return logToolResult('Harness tool result received', {
              turn,
              toolCallId: part.id,
              toolName: part.name,
              isFailure: part.isFailure,
            }).pipe(
              Effect.flatMap(() =>
                fireHooks(config, {
                  _tag: 'ToolResult',
                  id: part.id,
                  name: part.name,
                  result: resultText,
                  display: presentation?.display,
                  isFailure: part.isFailure,
                })
              )
            )
          }

          case 'finish': {
            const inputTokens = part.usage.inputTokens.total ?? 0
            const outputTokens = part.usage.outputTokens.total ?? 0
            return Effect.sync(() => {
              // Turn completed normally — clear currentTurnParts so the
              // interrupt path knows there's nothing to recover.
              state.currentTurnParts = []
              state.usage.inputTokens += inputTokens
              state.usage.outputTokens += outputTokens
              state.usage.totalTokens += inputTokens + outputTokens
            }).pipe(
              Effect.flatMap(() =>
                Effect.logDebug('Harness turn finished', {
                  turn,
                  inputTokens,
                  outputTokens,
                })
              )
            )
          }
        }

        return Effect.void
      })

      return hadToolCalls
    })

    const runToolLoop = Effect.fn('Harness.runToolLoop')(function* () {
      // First turn: empty prompt — the conversation already ends with the
      // user's message, so Chat.streamText sends it as-is. Subsequent turns
      // also use empty (tool results are in Chat).
      let prompt: Prompt.RawInput = [] as Array<Prompt.MessageEncoded>

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const hadToolCalls = yield* runTurn(turn, prompt)

        if (!hadToolCalls) break
        yield* Effect.logDebug('Harness turn requested tool follow-up', {
          turn,
        })

        // Turn completed — reset for next turn
        state.currentTurnParts = []
        prompt = [] as Array<Prompt.MessageEncoded>
      }
    })

    const finalizeRun = Effect.fn('Harness.finalizeRun')(function* (
      exit: Exit.Exit<void, AiError.AiError | HookE>
    ) {
      // Uninterruptible from here: fire RunEnd, read history, and return the
      // result — guaranteed to complete even after interrupt.
      yield* fireHooks(config, {
        _tag: 'RunEnd',
        output: state.outputText,
        usage: state.usage,
      })

      let fullConversation = yield* Ref.get(chat.history)

      // On interrupt, @effect/ai's Prompt.fromResponseParts drops in-flight
      // text/reasoning (it only flushes on block end parts, which never arrive).
      // If there's partial content from the interrupted turn, append a synthetic
      // assistant message so it gets persisted.
      const wasInterrupted =
        Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

      if (wasInterrupted && state.currentTurnParts.length > 0) {
        yield* Effect.logInfo('Harness recovering interrupted content', {
          recoveredPartCount: state.currentTurnParts.length,
        })
        fullConversation = Prompt.fromMessages([
          ...fullConversation.content,
          {
            ...Prompt.makeMessage('assistant', {
              content: state.currentTurnParts,
            }),
          },
        ])
      }

      // Re-surface real failures so the caller's error channel is preserved.
      // Interrupts are swallowed — the partial result IS the return value.
      if (Exit.isFailure(exit) && !wasInterrupted) {
        yield* Effect.logError('Harness run failed', {
          cause: Cause.pretty(exit.cause),
        })
        return yield* Effect.failCause(exit.cause)
      }

      const result = {
        conversation: fullConversation,
        toolCallDisplays,
        toolResultDisplays,
        text: state.outputText,
        usage: state.usage,
      } satisfies HarnessResult

      // Fire RunResult inside the uninterruptible region so hooks
      // (e.g. persistence) are guaranteed to run even on interrupt.
      yield* fireHooks(config, {
        _tag: 'RunResult',
        result,
        interrupted: wasInterrupted,
      })

      yield* Effect.logInfo('Harness run completed', {
        interrupted: wasInterrupted,
        outputLength: state.outputText.length,
        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens,
        totalTokens: state.usage.totalTokens,
      })

      return result
    })

    yield* fireHooks(config, { _tag: 'RunStart' })

    // The agent loop runs interruptibly so the user can stop it mid-
    // stream. But cleanup (RunEnd hook, reading history, returning the
    // result) MUST run even after interrupt — otherwise callers can't
    // persist partial content.
    //
    // uninterruptibleMask gives us both: `restore` re-enables interrupts
    // for the inner loop, while everything after Effect.exit runs in
    // the uninterruptible outer region.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.logInfo('Harness run starting', {
        messageCount: conversation.content.length,
        hookCount: config.hooks?.length ?? 0,
        hasToolkit: config.toolkit !== undefined,
      }).pipe(
        Effect.flatMap(() => Effect.exit(restore(runToolLoop()))),
        Effect.flatMap(finalizeRun)
      )
    )
  }).pipe(
    Effect.annotateLogs({ package: 'core', subsystem: 'harness' }),
    Effect.withLogSpan('harness.run')
  )
