/**
 * EvalSuite — the contract between the CLI and individual eval definitions.
 *
 * Each eval folder exports an EvalSuite: a fully-described, self-contained
 * benchmark that the CLI can discover, describe, and run without knowing
 * anything about its internals.
 *
 * The suite is responsible for wiring its own layers (model, sandbox, etc.).
 * The CLI's only job is to call `suite.run` and format the results.
 */
import type { Effect } from 'effect'
import type { BenchmarkResult } from '@agents/bench'

// ---------------------------------------------------------------------------
// EvalSuite
// ---------------------------------------------------------------------------

/**
 * A fully self-contained eval that the CLI can run.
 *
 * The `run` effect must have all requirements satisfied (R = never).
 * Suite authors are responsible for providing their own layers.
 *
 * Generic over `E` because different suites may fail with different errors,
 * but the CLI renders all failures uniformly via `Effect.runPromise`.
 */
export interface EvalSuite {
  /** Stable identifier — matches the folder name by convention. */
  readonly name: string

  /** One-line description shown in `list` output. */
  readonly description: string

  /**
   * Run the full benchmark pipeline.
   *
   * Returns BenchmarkResult<any, any> because the CLI doesn't care about
   * the scenario's Input/Meta types — it just formats the results.
   */
  readonly run: Effect.Effect<BenchmarkResult<any, any>, unknown>
}
