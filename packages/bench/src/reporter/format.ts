import { Effect } from 'effect'
import type { BenchmarkResult, ScenarioResult } from '../runner/runner.ts'
import { finalAssistantText } from '../rubric/rubric.ts'
import { ReporterError } from './reporter.ts'

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

const formatScenarioLine = <I, M>(r: ScenarioResult<I, M>): string => {
  const reason = r.score.reason ? ` — ${r.score.reason}` : ''
  return `  ${r.scenario.id}: ${r.score.score}${reason}`
}

/**
 * Render a `BenchmarkResult` as a human-readable string suitable for
 * printing to the terminal.
 */
export const formatSummary = <I, M>(result: BenchmarkResult<I, M>): string => {
  const lines: Array<string> = []

  lines.push(result.datasetName)
  lines.push(`${'─'.repeat(50)}`)

  for (const r of result.results) {
    lines.push(formatScenarioLine(r))
  }

  lines.push(`${'─'.repeat(50)}`)
  lines.push(
    `  ${result.summary.total} scenarios` +
      `  avg score: ${result.summary.averageScore.toFixed(2)}`
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
 * Includes the actual model response for each scenario so results
 * are debuggable without the full conversation history.
 */
export const toJson = <I, M>(result: BenchmarkResult<I, M>): string =>
  JSON.stringify(
    {
      datasetName: result.datasetName,
      summary: result.summary,
      results: result.results.map((r) => ({
        scenarioId: r.scenario.id,
        rubric: r.scenario.rubric.name,
        rubricDescription: r.scenario.rubric.description,
        input: r.scenario.input,
        metadata: r.scenario.metadata,
        output: finalAssistantText(r.harnessResult.conversation),
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
export const saveResult = <I, M>(
  result: BenchmarkResult<I, M>,
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
export const defaultResultPath = <I, M>(
  result: BenchmarkResult<I, M>,
  baseDir = '.results'
): string => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const name = result.datasetName.replace(/[^a-zA-Z0-9-_]/g, '-')
  return `${baseDir}/${name}-${ts}.json`
}
