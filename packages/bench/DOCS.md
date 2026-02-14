# @agents/bench

Eval primitives built on top of `@agents/core`. This package owns the
benchmarking and evaluation stack (datasets, rubrics, runners, reporters).

## Architecture

- **Dataset** (`src/dataset/`) — collection of scenarios
- **Rubric** (`src/rubric/`) — evaluation of harness outcomes
- **Runner** (`src/runner/`) — orchestration over scenarios
- **Reporter** (`src/reporter/`) — formatting + persistence of results

## Related Context

- `packages/core/` — harness, sandbox, and tool primitives used by the runner
- `apps/evals/` — benchmark suites that use this package
