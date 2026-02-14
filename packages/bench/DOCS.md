# @agents/bench

Eval primitives built on top of `@agents/core`.

## Architecture

- **Test** (`src/test.ts`) — `eval_()` constructor, `run()` combinator, `TestResult`, `SuiteResult`. Tests are just Effects — dependencies flow via R, provided at the edge.
- **Reporter** (`src/reporter/`) — formatting + persistence of results. Pure functions over `SuiteResult` data.

## Related Context

- `packages/core/` — harness, sandbox, and tool primitives
- `apps/evals/` — benchmark suites that use this package
