/**
 * blazerbench — a composable LLM benchmarking library
 *
 * Re-exports every primitive so consumers can do:
 *   import { Dataset, Rubric, Harness, Runner, Sandbox } from "blazerbench"
 *
 * Or import from sub-paths for tree-shaking / clarity:
 *   import { fromArray } from "blazerbench/dataset"
 *   import { contains } from "blazerbench/rubric"
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

// Sandbox
export { Sandbox, SandboxError } from './sandbox/Sandbox.ts'
export type {
  SandboxSession,
  SandboxFactory,
  ExecResult,
} from './sandbox/Sandbox.ts'
export { LocalSandbox, LocalSandboxLive } from './sandbox/LocalSandbox.ts'

// Harness
export type {
  HarnessEvent,
  HarnessHook,
  HarnessConfig,
  HarnessResult,
} from './harness/Harness.ts'
export { run } from './harness/run.ts'

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
