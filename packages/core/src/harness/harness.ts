/**
 * Harness — the agent loop as composable types + functions.
 *
 * A Harness owns the full agent loop: sending input to a language model,
 * streaming the response, resolving tool calls, and returning text + usage.
 *
 * The `run` function (in `run.ts`) is the raw loop. This file provides:
 *   - Types: `HarnessConfig`, `HarnessResult`, `HarnessRunResult`
 *   - Hooks: `HarnessEvent`, `HarnessHook`
 *   - Helpers: `extractText` for pulling assistant text from a conversation
 *
 * Composability:
 *   - **Tools**: composed via @effect/ai's `Toolkit.merge`.
 *   - **Hooks**: arbitrary code on lifecycle events. Just functions → Effects.
 *   - **Model**: provided via Effect's `LanguageModel` service in R.
 */
import type { LanguageModel, Prompt, Tool } from 'effect/unstable/ai'
import type { Effect } from 'effect/Effect'
import type {
  MessageHeaderDisplay,
  ToolResultDisplay,
} from '../tool/tool-output.ts'

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Lifecycle events the harness emits. Hooks receive these in real-time
 * as the agent loop streams.
 */
export type HarnessEvent =
  | { readonly _tag: 'RunStart' }
  | { readonly _tag: 'TextDelta'; readonly delta: string }
  | { readonly _tag: 'ReasoningDelta'; readonly delta: string }
  | {
      readonly _tag: 'ToolCall'
      readonly id: string
      readonly name: string
      readonly params: unknown
      readonly header?: MessageHeaderDisplay | undefined
    }
  | {
      readonly _tag: 'ToolResult'
      readonly id: string
      readonly name: string
      readonly result: string
      readonly header?: MessageHeaderDisplay | undefined
      readonly bodyDisplay?: ToolResultDisplay | undefined
      readonly isFailure: boolean
    }
  | {
      readonly _tag: 'RunEnd'
      readonly output: string
      readonly usage: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly totalTokens: number
      }
    }
  | {
      readonly _tag: 'RunResult'
      readonly result: HarnessResult
      readonly interrupted: boolean
    }

/**
 * A hook is a named function that reacts to harness events.
 */
export interface HarnessHook<E = never, R = never> {
  readonly name: string
  readonly handle: (event: HarnessEvent) => Effect<void, E, R>
}

// ---------------------------------------------------------------------------
// HarnessConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for constructing a harness.
 */
export interface HarnessConfig<
  Tools extends Record<string, Tool.Any> = Record<string, never>,
  HookE = never,
  HookR = never,
> {
  /**
   * System prompt — convenience field for callers (evals). The `run()`
   * function itself does NOT read this; callers like `test()` use it to
   * build the initial conversation before passing it to `run()`.
   */
  readonly systemPrompt?: string | undefined

  /**
   * The toolkit — tools + handlers. Pass `Toolkit.empty` for no-tool runs.
   * Accepts either a resolved `WithHandler` or a `Toolkit` Effect (which
   * resolves handlers from the Effect context).
   */
  readonly toolkit: LanguageModel.ToolkitInput<Tools>

  /** Lifecycle hooks. All hooks run for every event — compose freely. */
  readonly hooks?: ReadonlyArray<HarnessHook<HookE, HookR>> | undefined
}

// ---------------------------------------------------------------------------
// HarnessResult
// ---------------------------------------------------------------------------

/**
 * The result of running an agent session through the harness.
 */
export interface HarnessResult {
  /** The complete conversation (system + user + all assistant/tool messages). */
  readonly conversation: Prompt.Prompt
  /** Human-facing header metadata keyed by tool call id. */
  readonly toolCallHeaders: ReadonlyMap<
    string,
    {
      readonly header?: MessageHeaderDisplay | undefined
    }
  >
  /** Human-facing header metadata keyed by tool call id. */
  readonly toolResultHeaders: ReadonlyMap<
    string,
    {
      readonly header?: MessageHeaderDisplay | undefined
    }
  >
  /** Human-facing body display metadata keyed by tool call id. */
  readonly toolResultBodyDisplays: ReadonlyMap<
    string,
    {
      readonly bodyDisplay?: ToolResultDisplay | undefined
    }
  >
  /** The concatenated text from all assistant messages across all turns. */
  readonly text: string
  /** Aggregate token usage across the session. */
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}
