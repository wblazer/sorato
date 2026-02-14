/**
 * @agents/bench — evaluation primitives built on @agents/core
 *
 * Re-exports every eval primitive so consumers can do:
 *   import { Dataset, Rubric, Runner } from "@agents/bench"
 *
 * Or import from sub-paths for clarity:
 *   import { fromArray } from "@agents/bench/dataset"
 *   import { contains } from "@agents/bench/rubric"
 */

// Dataset
export type { Scenario, Dataset } from './dataset/dataset.ts'
export { fromArray, fromEffect } from './dataset/dataset.ts'

// Rubric
export type { Score, Rubric, RunContext } from './rubric/rubric.ts'
export {
  finalAssistantText,
  fromFunction as rubricFromFunction,
  fromEffect as rubricFromEffect,
} from './rubric/rubric.ts'
export { exactMatch, contains, regex, llmJudge } from './rubric/builtins.ts'

// Runner
export type {
  ScenarioResult,
  BenchmarkResult,
  RunnerConfig,
  RunnerHooks,
  SandboxStrategy,
} from './runner/runner.ts'
export { RunnerError } from './runner/runner.ts'
export { runBenchmark, runStringBenchmark } from './runner/run-benchmark.ts'

// Reporter
export { ReporterError } from './reporter/reporter.ts'
export {
  formatSummary,
  toJson,
  saveResult,
  defaultResultPath,
} from './reporter/format.ts'
