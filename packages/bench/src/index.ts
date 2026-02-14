/**
 * @agents/bench — evaluation primitives built on @agents/core
 *
 * Tests are just Effects with dependencies.
 *   import { test, run, TestResult, SuiteResult } from "@agents/bench"
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
