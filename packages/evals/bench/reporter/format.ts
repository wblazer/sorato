import { Effect, Match } from 'effect'
import type { SuiteResult, TestResult } from '../test.ts'
import { ReporterError } from './reporter.ts'

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

const formatTestLine = (r: TestResult): string => {
  const icon = Match.value(r.passed).pipe(
    Match.when(true, () => '✓'),
    Match.orElse(() => '✗')
  )
  const reason = Match.value(r.reason).pipe(
    Match.when(undefined, () => ''),
    Match.orElse((reasonText) => ` — ${reasonText}`)
  )
  return `  ${icon} ${r.name}${reason}`
}

/**
 * Render a `SuiteResult` as a human-readable string.
 */
export const formatSuiteSummary = (result: SuiteResult): string => {
  const lines: Array<string> = []

  lines.push('Test Suite Results')
  lines.push(`${'─'.repeat(50)}`)

  for (const r of result.results) {
    lines.push(formatTestLine(r))
  }

  lines.push(`${'─'.repeat(50)}`)
  lines.push(
    `  ${result.summary.total} tests` +
      `  ${result.summary.passed} passed` +
      `  ${result.summary.failed} failed`
  )
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// JSON persistence
// ---------------------------------------------------------------------------

/**
 * Serialize a `SuiteResult` to JSON.
 */
export const suiteToJson = (result: SuiteResult): string =>
  JSON.stringify(
    {
      summary: result.summary,
      results: result.results.map((r) => {
        const score = Match.value(r.passed).pipe(
          Match.when(true, () => 1),
          Match.orElse(() => 0)
        )

        return {
          name: r.name,
          passed: r.passed,
          response: r.response,
          score,
          reason: r.reason,
          usage: r.usage,
        }
      }),
      timestamp: new Date().toISOString(),
    },
    null,
    2
  )

/**
 * Write a `SuiteResult` as JSON to the given file path.
 */
export const saveSuiteResult = Effect.fn('BenchReporter.saveSuiteResult')(
  function* (result: SuiteResult, path: string) {
    return yield* Effect.tryPromise({
      try: async () => {
        const json = suiteToJson(result)
        await Bun.write(path, json)
        return path
      },
      catch: (error) =>
        new ReporterError({
          operation: 'saveSuiteResult',
          message: `Failed to save result to ${path}`,
          error,
        }),
    })
  }
)

/**
 * Generate a default file path for a suite result.
 * Format: `.results/{name}-{ISO timestamp}.json`
 */
export const defaultSuiteResultPath = (
  name: string,
  baseDir = '.results'
): string => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '-')
  return `${baseDir}/${safeName}-${ts}.json`
}
