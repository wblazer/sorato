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
export type { Scenario, Dataset } from './dataset/Dataset.ts'
export { fromArray, fromEffect } from './dataset/Dataset.ts'

// Rubric
export type { Score, Rubric, RunContext } from './rubric/Rubric.ts'
export {
  finalAssistantText,
  fromFunction as rubricFromFunction,
  fromEffect as rubricFromEffect,
} from './rubric/Rubric.ts'
export { exactMatch, contains, regex, llmJudge } from './rubric/builtins.ts'

// Runner
export type {
  ScenarioResult,
  BenchmarkResult,
  RunnerConfig,
} from './runner/Runner.ts'
export { runBenchmark, runStringBenchmark } from './runner/runBenchmark.ts'

// Reporter
export { ReporterError } from './reporter/Reporter.ts'
export {
  formatSummary,
  toJson,
  saveResult,
  defaultResultPath,
} from './reporter/format.ts'
