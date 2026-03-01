/**
 * Evaluation primitives built on @agents/agent
 *
 * Tests are just Effects with dependencies.
 *   import { test, run, TestResult, SuiteResult } from "./bench/index.ts"
 *
 * Dependencies provided via Effect Layers at the edge.
 */

// Test API
export type {
  Test,
  TestResult,
  SuiteResult,
  RunOptions,
  TestOptions,
} from './test.ts'
export { test, run } from './test.ts'

// Reporter
export { ReporterError } from './reporter/reporter.ts'
export {
  formatSuiteSummary,
  suiteToJson,
  saveSuiteResult,
  defaultSuiteResultPath,
} from './reporter/format.ts'
