# Rubric

Evaluates harness output. Receives a `RunContext` with the full sandbox session, conversation, scenario, and usage — not just a string. String comparison is the special case.

## Files

- `Rubric.ts` — types (`RunContext`, `Score`, `Rubric`), constructors (`fromFunction`, `fromEffect`), and the `finalAssistantText` helper
- `builtins.ts` — shipped rubrics: `exactMatch`, `contains`, `regex`, `llmJudge`

## Key Points

- Rubrics live on scenarios, not datasets — per-scenario evaluation strategies
- Sandbox access in rubrics enables checking real world state (e.g., `sandbox.exec("bun test")`)

## Related Context

- `src/sandbox/` — provides the sandbox session rubrics can inspect
- `src/dataset/` — scenarios carry their rubrics
- `src/runner/` — builds RunContext and invokes evaluation
