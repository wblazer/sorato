/**
 * Evaluation primitives built on @agents/agent
 *
 * Tests are just Effects with dependencies.
 *   import { test, run, TestResult, SuiteResult } from "./bench/index.ts"
 *
 * Dependencies provided via Effect Layers at the edge.
 */
import { Effect, type Scope } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// ---------------------------------------------------------------------------
// Sandbox helpers
// ---------------------------------------------------------------------------

/**
 * Create a scoped temporary directory. Automatically removed when the
 * enclosing `Effect.scoped` block closes. Use this to provision throwaway
 * roots for `Sandbox.acquire` in eval scenarios.
 */
export const makeTempDir: Effect.Effect<string, never, Scope.Scope> =
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'agents-sandbox-'))),
    (dir) =>
      Effect.promise(() => rm(dir, { recursive: true, force: true })).pipe(
        Effect.orDie
      )
  )
