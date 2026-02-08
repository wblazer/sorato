/**
 * Result formatting utilities for benchmark runs.
 *
 * Two functions, both operating on the same `BenchmarkResult` data:
 *   - `formatSummary` — human-readable console output
 *   - `saveResult`    — writes the full result as JSON to disk
 *
 * These are convenience defaults. Consumers can ignore them entirely and
 * do whatever they like with `BenchmarkResult` — it's just data.
 */
import { Effect, Schema } from 'effect'
import type { BenchmarkResult, ScenarioResult } from '../runner/Runner.ts'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ReporterError extends Schema.TaggedError<ReporterError>()(
  'ReporterError',
  {
    operation: Schema.String,
    message: Schema.String,
    error: Schema.optional(Schema.Defect),
  }
) {}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

const formatScenarioLine = <I, E, M>(r: ScenarioResult<I, E, M>): string => {
  const icon = r.score.pass ? '✓' : '✗'
  const reason = r.score.reason ? ` — ${r.score.reason}` : ''
  return `  ${icon} ${r.scenario.id} (${r.score.score})${reason}`
}

/**
 * Render a `BenchmarkResult` as a human-readable string suitable for
 * printing to the terminal.
 */
export const formatSummary = <I, E, M>(
  result: BenchmarkResult<I, E, M>
): string => {
  const lines: Array<string> = []

  lines.push(`\n  ${result.datasetName} × ${result.rubricName}`)
  lines.push(`${'─'.repeat(50)}`)

  for (const r of result.results) {
    lines.push(formatScenarioLine(r))
  }

  lines.push(`${'─'.repeat(50)}`)
  lines.push(
    `  ${result.summary.passed}/${result.summary.total} passed` +
      `  avg: ${result.summary.averageScore.toFixed(2)}` +
      `  failed: ${result.summary.failed}`
  )
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// JSON persistence
// ---------------------------------------------------------------------------

/**
 * Serialize a `BenchmarkResult` to a stable JSON representation.
 *
 * Strips the conversation history (which is large and not useful for
 * diffing) and keeps scenario id, score, and usage.
 */
export const toJson = <I, E, M>(result: BenchmarkResult<I, E, M>): string =>
  JSON.stringify(
    {
      datasetName: result.datasetName,
      rubricName: result.rubricName,
      summary: result.summary,
      results: result.results.map((r) => ({
        scenarioId: r.scenario.id,
        input: r.scenario.input,
        expected: r.scenario.expected,
        score: r.score,
        usage: r.harnessResult.usage,
      })),
      timestamp: new Date().toISOString(),
    },
    null,
    2
  )

/**
 * Write a `BenchmarkResult` as JSON to the given file path.
 *
 * Creates parent directories as needed.
 */
export const saveResult = <I, E, M>(
  result: BenchmarkResult<I, E, M>,
  path: string
): Effect.Effect<string, ReporterError> =>
  Effect.tryPromise({
    try: async () => {
      const json = toJson(result)
      await Bun.write(path, json)
      return path
    },
    catch: (error) =>
      new ReporterError({
        operation: 'saveResult',
        message: `Failed to save result to ${path}`,
        error,
      }),
  })

/**
 * Generate a default file path for a benchmark result.
 * Format: `.results/{datasetName}-{ISO timestamp}.json`
 */
export const defaultResultPath = <I, E, M>(
  result: BenchmarkResult<I, E, M>,
  baseDir = '.results'
): string => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const name = result.datasetName.replace(/[^a-zA-Z0-9-_]/g, '-')
  return `${baseDir}/${name}-${ts}.json`
}
