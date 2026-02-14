# Reporter

Formats and persists benchmark results. Pure functions over `BenchmarkResult` data — no service tag, no Layer.

## Files

- `Reporter.ts` — `ReporterError` type
- `format.ts` — `formatSummary`, `toJson`, `saveResult`, `defaultResultPath`

## Related Context

- `src/runner/` — produces the `BenchmarkResult` that the reporter formats
