/**
 * The Runner is the orchestration layer. It takes a Dataset and a Harness
 * config, then:
 *   1. Loads scenarios from the dataset
 *   2. Runs each scenario through the harness (full agent loop)
 *   3. Builds a RunContext and passes it to the scenario's rubric
 *   4. Collects and returns the results
 *
 * Concurrency is configurable — default is sequential (concurrency: 1) so you
 * don't accidentally blow rate limits or burn money.
 */
import { Schema } from 'effect'
import type { Effect } from 'effect'
import type { HarnessResult, SandboxSession } from '@agents/core'
import type { Scenario } from '../dataset/Dataset.ts'
import type { Score } from '../rubric/Rubric.ts'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result for a single scenario. */
export interface ScenarioResult<Input, Meta> {
  readonly scenario: Scenario<Input, Meta>
  readonly harnessResult: HarnessResult
  readonly score: Score
}

// ---------------------------------------------------------------------------
// Runner hooks
// ---------------------------------------------------------------------------

export interface ScenarioContext<Input, Meta> {
  readonly scenario: Scenario<Input, Meta>
  readonly sandbox: SandboxSession
}

export interface RunnerHooks<Input, Meta, SetupE = never, R = never> {
  /** Runs before each scenario (use for setup/fixtures). */
  readonly setup?: (
    ctx: ScenarioContext<Input, Meta>
  ) => Effect.Effect<void, SetupE, R>
  /** Runs after each scenario (always, even on failure). Must not fail. */
  readonly cleanup?: (
    ctx: ScenarioContext<Input, Meta>
  ) => Effect.Effect<void, never, R>
}

// ---------------------------------------------------------------------------
// Sandbox strategy
// ---------------------------------------------------------------------------

/** Controls how sandbox sessions are acquired for a run. */
export type SandboxStrategy = 'perScenario' | 'perRun'

/** Aggregate results for an entire benchmark run. */
export interface BenchmarkResult<Input, Meta> {
  readonly datasetName: string
  readonly results: ReadonlyArray<ScenarioResult<Input, Meta>>
  readonly summary: {
    readonly total: number
    readonly averageScore: number
  }
}

// ---------------------------------------------------------------------------
// Runner config
// ---------------------------------------------------------------------------

export interface RunnerConfig {
  /** Max concurrent scenario runs. Defaults to 1 (sequential). */
  readonly concurrency?: number | undefined
  /** Sandbox reuse strategy. Defaults to perScenario. */
  readonly sandboxStrategy?: SandboxStrategy | undefined
}

// ---------------------------------------------------------------------------
// Runner errors
// ---------------------------------------------------------------------------

export class RunnerError extends Schema.TaggedError<RunnerError>()(
  'RunnerError',
  {
    operation: Schema.String,
    message: Schema.String,
    error: Schema.optional(Schema.Defect),
  }
) {}
