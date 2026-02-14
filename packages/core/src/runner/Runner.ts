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
import type { Scenario } from '../dataset/Dataset.ts'
import type { HarnessResult } from '../harness/Harness.ts'
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
}
