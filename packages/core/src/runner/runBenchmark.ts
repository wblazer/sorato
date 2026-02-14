import { Effect } from 'effect'
import type { AiError, LanguageModel, Tool } from '@effect/ai'
import type { Dataset } from '../dataset/Dataset.ts'
import type { HarnessConfig } from '../harness/Harness.ts'
import { run as runHarness } from '../harness/run.ts'
import type { RunContext } from '../rubric/Rubric.ts'
import { Sandbox, type SandboxError } from '../sandbox/Sandbox.ts'
import type { BenchmarkResult, RunnerConfig, ScenarioResult } from './Runner.ts'

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a complete benchmark: dataset -> harness -> scenario rubrics -> results.
 *
 * Each scenario carries its own rubric, so different scenarios within the
 * same dataset can be evaluated with entirely different strategies.
 *
 * `inputToPrompt` converts a scenario's input into the string prompt fed to
 * the harness. For `Dataset<string, ...>` this is just identity.
 */
export const runBenchmark = <
  Input,
  Meta,
  DatasetE = never,
  DatasetR = never,
  Tools extends Record<string, Tool.Any> = Record<string, never>,
  HookE = never,
  HookR = never,
>(options: {
  readonly dataset: Dataset<Input, Meta, DatasetE, DatasetR>
  readonly harness: HarnessConfig<Tools, HookE, HookR>
  readonly inputToPrompt: (input: Input) => string
  readonly config?: RunnerConfig | undefined
}): Effect.Effect<
  BenchmarkResult<Input, Meta>,
  DatasetE | AiError.AiError | HookE | SandboxError,
  DatasetR | LanguageModel.LanguageModel | HookR | Sandbox
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

            const ctx: RunContext<Input, Meta> = {
              scenario,
              conversation: harnessResult.conversation,
              sandbox,
              usage: harnessResult.usage,
            }

            const score = yield* scenario.rubric.evaluate(ctx)

            return {
              scenario,
              harnessResult,
              score,
            } satisfies ScenarioResult<Input, Meta>
          })
        ),
      { concurrency }
    )

    // 3. Compute summary
    const total = results.length
    const averageScore =
      total > 0 ? results.reduce((sum, r) => sum + r.score.score, 0) / total : 0

    return {
      datasetName: options.dataset.name,
      results,
      summary: { total, averageScore },
    } satisfies BenchmarkResult<Input, Meta>
  })

// ---------------------------------------------------------------------------
// Convenience: string-in, string-out benchmark
// ---------------------------------------------------------------------------

/**
 * A simplified runner for the common case where input is a plain string.
 * No need to supply `inputToPrompt`.
 */
export const runStringBenchmark = <
  Meta,
  DatasetE = never,
  DatasetR = never,
  Tools extends Record<string, Tool.Any> = Record<string, never>,
  HookE = never,
  HookR = never,
>(options: {
  readonly dataset: Dataset<string, Meta, DatasetE, DatasetR>
  readonly harness: HarnessConfig<Tools, HookE, HookR>
  readonly config?: RunnerConfig | undefined
}): Effect.Effect<
  BenchmarkResult<string, Meta>,
  DatasetE | AiError.AiError | HookE | SandboxError,
  DatasetR | LanguageModel.LanguageModel | HookR | Sandbox
> =>
  runBenchmark({
    ...options,
    inputToPrompt: (s) => s,
  })
