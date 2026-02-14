# Dataset

A collection of scenarios — the inputs to a benchmark or agent run. Generic over input type, metadata, and loading requirements.

## Files

- `Dataset.ts` — `Scenario` and `Dataset` types, `fromArray` and `fromEffect` constructors

## Key Points

- Each scenario carries its own rubric — different evaluation strategies within the same dataset
- Stable `id` fields for diffing results across runs
- Loading is effectful (`Effect`) — datasets can come from files, APIs, databases

## Related Context

- `src/rubric/` — rubrics that evaluate scenario outcomes
- `src/runner/` — consumes datasets to run benchmarks
