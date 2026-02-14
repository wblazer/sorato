# Runner

Batch-mode orchestration: dataset -> harness -> rubric -> results. One use case of the primitives, not the only one.

## Files

- `Runner.ts` — types: `ScenarioResult`, `BenchmarkResult`, `RunnerConfig`
- `runBenchmark.ts` — `runBenchmark` and `runStringBenchmark` functions. Acquires a scoped sandbox per scenario, provides `CurrentSandbox` into the scope, resolves the effectful harness config (so tools can access the sandbox), runs the harness, evaluates the rubric, collects results.

## Not the Only Execution Path

Other patterns (webhook handler, web UI, cron-triggered agent) are userland code that calls `Harness.run` directly. The runner is the batch path.

## Related Context

- `src/harness/` — the agent loop the runner invokes
- `src/dataset/` — provides scenarios
- `src/rubric/` — evaluates outcomes
- `src/sandbox/` — provides isolated sessions per scenario
- `src/reporter/` — formats runner output
