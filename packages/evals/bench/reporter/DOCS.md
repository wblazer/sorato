# Reporter

Formats and persists benchmark results. Pure functions over `SuiteResult` data — no service tag, no Layer.

This folder exists so eval execution can stay focused on producing results while reporting stays optional and replaceable. Add code here when the change is about how a finished suite is rendered or saved. If the change affects how tests are executed, it belongs in `../test.ts` instead.

## Design Constraints

- Keep reporting as a pure post-processing step over `SuiteResult`.
- Do not make reporters responsible for running suites or interpreting agent behavior.
- Prefer plain data transformations so callers can swap in different sinks later.

## Related Context

- `../DOCS.md` — shared eval primitive boundaries
- `../test.ts` — produces the `SuiteResult` that the reporter formats
