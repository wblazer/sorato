/**
 * A Harness is the "agent under test." It owns the full agent loop: sending
 * the scenario input to a language model, streaming the response, resolving
 * tool calls, and returning the complete conversation history.
 *
 * The harness uses `streamText` under the hood, which gives us visibility
 * into every step of the agent loop — text deltas, tool calls, tool results,
 * finish events. Hooks fire on each of these, so consumers can log, guard,
 * count tokens, or implement custom control flow.
 *
 * Composability:
 *   - **Tools**: composed via @effect/ai's `Toolkit.merge`.
 *   - **Hooks**: arbitrary code on lifecycle events. Just functions → Effects.
 *   - **Model**: provided via Effect's `LanguageModel` service.
 */
import type { AiError, Prompt, Response, Toolkit } from '@effect/ai'
import type { Effect } from 'effect'

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Lifecycle events the harness emits. Hooks receive these in real-time
 * as the agent loop streams.
 */
export type HarnessEvent =
  | { readonly _tag: 'RunStart'; readonly input: string }
  | { readonly _tag: 'TextDelta'; readonly delta: string }
  | {
      readonly _tag: 'ToolCall'
      readonly id: string
      readonly name: string
      readonly params: unknown
    }
  | {
      readonly _tag: 'ToolResult'
      readonly id: string
      readonly name: string
      readonly result: unknown
      readonly isFailure: boolean
    }
  | {
      readonly _tag: 'RunEnd'
      readonly input: string
      readonly output: string
      readonly usage: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly totalTokens: number
      }
    }

/**
 * A hook is a named function that reacts to harness events.
 */
export interface HarnessHook<E = never, R = never> {
  readonly name: string
  readonly handle: (event: HarnessEvent) => Effect.Effect<void, E, R>
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Configuration for constructing a harness.
 */
export interface HarnessConfig<
  Tools extends Record<string, import('@effect/ai').Tool.Any> = Record<
    string,
    never
  >,
  HookE = never,
  HookR = never,
> {
  /** System prompt prepended to every scenario run. */
  readonly systemPrompt?: string | undefined

  /** The composed toolkit (tools + handlers). */
  readonly toolkit?: Toolkit.WithHandler<Tools> | undefined

  /** Lifecycle hooks. All hooks run for every event — compose freely. */
  readonly hooks?: ReadonlyArray<HarnessHook<HookE, HookR>> | undefined
}

/**
 * The result of running a complete agent session through a harness.
 */
export interface HarnessResult {
  /** The complete conversation (system + user + all assistant/tool messages). */
  readonly conversation: Prompt.Prompt
  /** Aggregate token usage across the session. */
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

// ---------------------------------------------------------------------------
// Running a harness
// ---------------------------------------------------------------------------

/**
 * Run a complete agent loop for a single scenario input.
 *
 * Uses `streamText` to get real-time visibility into the agent loop.
 * Hooks fire on every stream part — text deltas, tool calls, tool results.
 * The full conversation is captured via the Chat history ref.
 */
export const run = <
  Tools extends Record<string, import('@effect/ai').Tool.Any>,
  HookE,
  HookR,
>(
  input: string,
  config: HarnessConfig<Tools, HookE, HookR>
): Effect.Effect<
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

// Runtime imports
import { Effect as Effect_, Ref as Ref_, Stream as Stream_ } from 'effect'
import { LanguageModel as LanguageModel_, Chat as Chat_ } from '@effect/ai'
