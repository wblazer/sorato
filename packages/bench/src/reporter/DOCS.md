# Reporter

Formats and persists benchmark results. Pure functions over `SuiteResult` data — no service tag, no Layer.

## Files

- `reporter.ts` — `ReporterError` type
- `format.ts` — `formatSuiteSummary`, `suiteToJson`, `saveSuiteResult`, `defaultSuiteResultPath`

## Related Context

- `src/test.ts` — produces the `SuiteResult` that the reporter formats
