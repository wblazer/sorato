# Harness

The "agent under test." Composes a system prompt, tools, and hooks into a complete agent loop. The fundamental unit of agent composition.

## Files

- `Harness.ts` — types: `HarnessEvent`, `HarnessHook`, `HarnessConfig`, `HarnessResult`
- `run.ts` — the `run` function: `streamText`-based agent loop with hook dispatch and usage tracking

## Memory Is Hooks

Memory is NOT a separate primitive. It's a harness concern implemented through hooks. A `beforeRun` hook that does vector search _is_ RAG. A hook that loads AGENTS.md files _is_ codebase memory. The hook system is expressive enough; no separate abstraction needed.

## Never Do

- Never put memory logic in the runner or as a peer primitive — it belongs in harness hooks
- Never bypass the hook system for observability

## Related Context

- `src/sandbox/` — where tool calls execute
- `src/runner/` — orchestrates harness runs over datasets
- `src/rubric/` — evaluates harness output
