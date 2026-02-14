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
import type { Prompt, Tool, Toolkit } from '@effect/ai'
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
  Tools extends Record<string, Tool.Any> = Record<string, never>,
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
