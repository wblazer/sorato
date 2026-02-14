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
import { Schema } from 'effect'

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
