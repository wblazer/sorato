# Bench

Shared eval primitives built on `@agents/agent`.

This folder exists so eval suites can stay small and declarative. If you are adding a new benchmark scenario, you should usually add code in a suite directory and reuse the primitives here. Add code here only when you are changing how evals are constructed, run, or reported across many suites.

## What Belongs Here

- `test.ts` owns the eval model: tests are Effects, suites are collections of tests, and dependencies flow through `R` like the rest of the codebase.
- `index.ts` is the public surface for eval authors. Keep convenience exports and shared helpers there.
- `reporter/` owns presentation and persistence of suite results. Keep result formatting out of the test constructor and runner.

## Design Constraints

- Eval primitives should stay thin. They should compose harness/session/sandbox layers, not invent a parallel framework.
- A suite should wire its own dependencies. The bench layer should not quietly decide which model, sandbox, or tools a suite must use.
- Results are plain data. Reporting is optional and replaceable.

## Never Do

- Never bake one suite's assumptions into the shared test constructor.
- Never hide required dependencies behind global setup.
- Never let reporter concerns leak back into test execution.

## Related Context

- `../DOCS.md` — how suites are discovered and added
- `reporter/DOCS.md` — result formatting and persistence
- `../../agent/DOCS.md` — the primitives evals exercise
