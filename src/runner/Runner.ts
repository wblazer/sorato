/**
 * The Runner is the orchestration layer. It takes a Dataset, a Harness config,
 * and a Rubric, then:
 *   1. Loads scenarios from the dataset
 *   2. Runs each scenario through the harness (full agent loop)
 *   3. Builds a RunContext and passes it to the rubric
 *   4. Collects and returns the results
 *
 * Concurrency is configurable — default is sequential (concurrency: 1) so you
 * don't accidentally blow rate limits or burn money.
 */
import { Effect } from 'effect'
import type { AiError, LanguageModel, Tool } from '@effect/ai'
import type { Dataset, Scenario } from '../dataset/Dataset.ts'
import type { HarnessConfig, HarnessResult } from '../harness/Harness.ts'
import { run as runHarness } from '../harness/Harness.ts'
import type { Rubric, RunContext, Score } from '../rubric/Rubric.ts'
import { Sandbox, type SandboxError } from '../sandbox/Sandbox.ts'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result for a single scenario. */
export interface ScenarioResult<Input, Expected, Meta> {
  readonly scenario: Scenario<Input, Expected, Meta>
  readonly harnessResult: HarnessResult
  readonly score: Score
}

/** Aggregate results for an entire benchmark run. */
export interface BenchmarkResult<Input, Expected, Meta> {
  readonly datasetName: string
  readonly rubricName: string
  readonly results: ReadonlyArray<ScenarioResult<Input, Expected, Meta>>
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
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

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a complete benchmark: dataset -> harness -> rubric -> results.
 *
 * `inputToPrompt` converts a scenario's input into the string prompt fed to
 * the harness. For `Dataset<string, ...>` this is just identity.
 */
export const runBenchmark = <
  Input,
  Expected,
  Meta,
  DatasetE = never,
  DatasetR = never,
  Tools extends Record<string, Tool.Any> = Record<string, never>,
  HookE = never,
  HookR = never,
  RubricE = never,
  RubricR = never,
>(options: {
  readonly dataset: Dataset<Input, Expected, Meta, DatasetE, DatasetR>
  readonly harness: HarnessConfig<Tools, HookE, HookR>
  readonly rubric: Rubric<Input, Expected, Meta, RubricE, RubricR>
  readonly inputToPrompt: (input: Input) => string
  readonly config?: RunnerConfig | undefined
}): Effect.Effect<
  BenchmarkResult<Input, Expected, Meta>,
  DatasetE | AiError.AiError | HookE | RubricE | SandboxError,
  DatasetR | LanguageModel.LanguageModel | HookR | RubricR | Sandbox
> =>
  Effect.gen(function* () {
    const concurrency = options.config?.concurrency ?? 1
    const sandboxFactory = yield* Sandbox

    // 1. Load scenarios
    const scenarios = yield* options.dataset.scenarios

    // 2. Run each scenario through the harness, build RunContext, evaluate
    //    Each scenario gets its own scoped sandbox session.
    const results = yield* Effect.forEach(
      scenarios,
      (scenario) =>
        Effect.scoped(
          Effect.gen(function* () {
            const sandbox = yield* sandboxFactory.acquire
            const prompt = options.inputToPrompt(scenario.input)
            const harnessResult = yield* runHarness(prompt, options.harness)

            const ctx: RunContext<Input, Expected, Meta> = {
              scenario,
              conversation: harnessResult.conversation,
              sandbox,
              usage: harnessResult.usage,
            }

            const score = yield* options.rubric.evaluate(ctx)

            return {
              scenario,
              harnessResult,
              score,
            } satisfies ScenarioResult<Input, Expected, Meta>
          })
        ),
      { concurrency }
    )

    // 3. Compute summary
    const total = results.length
    const passed = results.filter((r) => r.score.pass).length
    const failed = total - passed
    const averageScore =
      total > 0 ? results.reduce((sum, r) => sum + r.score.score, 0) / total : 0

    return {
      datasetName: options.dataset.name,
      rubricName: options.rubric.name,
      results,
      summary: { total, passed, failed, averageScore },
    } satisfies BenchmarkResult<Input, Expected, Meta>
  })

// ---------------------------------------------------------------------------
// Convenience: string-in, string-out benchmark
// ---------------------------------------------------------------------------

/**
 * A simplified runner for the common case where input is a plain string.
 * No need to supply `inputToPrompt`.
 */
export const runStringBenchmark = <
  Expected,
  Meta,
  DatasetE = never,
  DatasetR = never,
  Tools extends Record<string, Tool.Any> = Record<string, never>,
  HookE = never,
  HookR = never,
  RubricE = never,
  RubricR = never,
>(options: {
  readonly dataset: Dataset<string, Expected, Meta, DatasetE, DatasetR>
  readonly harness: HarnessConfig<Tools, HookE, HookR>
  readonly rubric: Rubric<string, Expected, Meta, RubricE, RubricR>
  readonly config?: RunnerConfig | undefined
}): Effect.Effect<
  BenchmarkResult<string, Expected, Meta>,
  DatasetE | AiError.AiError | HookE | RubricE | SandboxError,
  DatasetR | LanguageModel.LanguageModel | HookR | RubricR | Sandbox
> =>
  runBenchmark({
    ...options,
    inputToPrompt: (s) => s,
  })
