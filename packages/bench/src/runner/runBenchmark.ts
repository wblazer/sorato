import { Effect, Layer } from 'effect'
import type { AiError, LanguageModel, Tool } from '@effect/ai'
import {
  run as runHarness,
  Sandbox,
  CurrentSandbox,
  type HarnessConfig,
  type SandboxError,
  type SandboxSession,
} from '@agents/core'
import type { Dataset } from '../dataset/Dataset.ts'
import type { RunContext } from '../rubric/Rubric.ts'
import { RunnerError } from './Runner.ts'
import type {
  BenchmarkResult,
  RunnerConfig,
  RunnerHooks,
  ScenarioResult,
} from './Runner.ts'

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a complete benchmark: dataset -> harness -> scenario rubrics -> results.
 *
 * Each scenario carries its own rubric, so different scenarios within the
 * same dataset can be evaluated with entirely different strategies.
 *
 * The `harness` field is an Effect that produces a `HarnessConfig`. This lets
 * tools that need `CurrentSandbox` be resolved inside the scenario scope where
 * the sandbox session is available. For the simple no-tools case, wrap with
 * `Effect.succeed({ systemPrompt: "..." })`.
 *
 * `hooks` provide per-scenario setup/cleanup with access to the sandbox.
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
  RunnerHookE = never,
  RunnerHookR = never,
  HarnessE = never,
  HarnessR = never,
>(options: {
  readonly dataset: Dataset<Input, Meta, DatasetE, DatasetR>
  readonly harness: Effect.Effect<
    HarnessConfig<Tools, HookE, HookR>,
    HarnessE,
    HarnessR
  >
  readonly inputToPrompt: (input: Input) => string
  readonly hooks?:
    | RunnerHooks<Input, Meta, RunnerHookE, RunnerHookR>
    | undefined
  readonly config?: RunnerConfig | undefined
}): Effect.Effect<
  BenchmarkResult<Input, Meta>,
  | DatasetE
  | AiError.AiError
  | HookE
  | RunnerHookE
  | HarnessE
  | SandboxError
  | RunnerError,
  | DatasetR
  | LanguageModel.LanguageModel
  | HookR
  | RunnerHookR
  | Exclude<HarnessR, CurrentSandbox>
  | Sandbox
> =>
  Effect.gen(function* () {
    const concurrency = options.config?.concurrency ?? 1
    const sandboxStrategy = options.config?.sandboxStrategy ?? 'perScenario'
    const sandboxFactory = yield* Sandbox
    const hooks = options.hooks

    // 1. Load scenarios
    const scenarios = yield* options.dataset.scenarios

    if (sandboxStrategy === 'perRun' && concurrency > 1) {
      return yield* new RunnerError({
        operation: 'sandboxStrategy',
        message: 'perRun sandboxStrategy requires concurrency = 1',
      })
    }

    const runScenario = (
      scenario: (typeof scenarios)[number],
      sandbox: SandboxSession
    ) => {
      const sandboxLayer = Layer.succeed(CurrentSandbox, sandbox)
      const scenarioContext = { scenario, sandbox }

      const run = Effect.gen(function* () {
        if (hooks?.setup) {
          yield* hooks.setup(scenarioContext)
        }

        // Resolve the harness config inside the sandbox scope — this is
        // where tool handlers get access to CurrentSandbox via their R.
        const harnessConfig = yield* Effect.provide(
          options.harness,
          sandboxLayer
        )

        const prompt = options.inputToPrompt(scenario.input)
        const harnessResult = yield* runHarness(prompt, harnessConfig)

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

      return hooks?.cleanup
        ? run.pipe(Effect.ensuring(hooks.cleanup(scenarioContext)))
        : run
    }

    // 2. Run each scenario through the harness, build RunContext, evaluate.
    //    Each scenario gets its own scoped sandbox session. The session is
    //    provided as `CurrentSandbox` so tool handlers can access it.
    const results =
      sandboxStrategy === 'perRun'
        ? yield* Effect.scoped(
            Effect.gen(function* () {
              const sandbox = yield* sandboxFactory.acquire
              return yield* Effect.forEach(
                scenarios,
                (scenario) => runScenario(scenario, sandbox),
                { concurrency: 1 }
              )
            })
          )
        : yield* Effect.forEach(
            scenarios,
            (scenario) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const sandbox = yield* sandboxFactory.acquire
                  return yield* runScenario(scenario, sandbox)
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
  RunnerHookE = never,
  RunnerHookR = never,
  HarnessE = never,
  HarnessR = never,
>(options: {
  readonly dataset: Dataset<string, Meta, DatasetE, DatasetR>
  readonly harness: Effect.Effect<
    HarnessConfig<Tools, HookE, HookR>,
    HarnessE,
    HarnessR
  >
  readonly hooks?:
    | RunnerHooks<string, Meta, RunnerHookE, RunnerHookR>
    | undefined
  readonly config?: RunnerConfig | undefined
}): Effect.Effect<
  BenchmarkResult<string, Meta>,
  | DatasetE
  | AiError.AiError
  | HookE
  | RunnerHookE
  | HarnessE
  | SandboxError
  | RunnerError,
  | DatasetR
  | LanguageModel.LanguageModel
  | HookR
  | RunnerHookR
  | Exclude<HarnessR, CurrentSandbox>
  | Sandbox
> =>
  runBenchmark({
    ...options,
    inputToPrompt: (s) => s,
  })
