# Evals

Benchmark eval suites that exercise `@agents/agent` and local bench primitives in `bench/`.

## Running Evals

```bash
# List available eval suites
bun run --filter @agents/evals start -- list

# Run a specific eval
bun run --filter @agents/evals <suite-name>

# Or via the CLI directly
bun run --filter @agents/evals start -- run <suite-name>
```

Requires `ANTHROPIC_API_KEY` in the environment.

## Adding a New Eval

1. Create a folder: `packages/evals/<name>/`
2. Add an `eval.ts` that exports `suite: EvalSuite` (see `suite.ts` for the contract)
3. Register it in `registry.ts`
4. Add a convenience script to `package.json`: `"<name>": "bun run cli.ts -- run <name>"`

Each suite is fully self-contained — it wires its own layers (model, sandbox, etc.). The CLI's only job is discovery and execution.

## Structure

- Top-level files define discovery and registration (`cli.ts`, `registry.ts`, `suite.ts`). Change those when the eval package itself needs new capabilities.
- Suite directories stay self-contained. Add fixtures, layer wiring, and checks next to the suite that needs them.
- Shared execution/reporting primitives live in `bench/`. If multiple suites need the same test or reporting behavior, put it there instead of copying it between suites.

## Design Constraints

- A suite should say what it is testing, not hide global behavior in the package root.
- Shared bench code should stay generic enough to serve many suites.
- The registry is the source of truth for which suites currently exist. Docs should explain the pattern, not enumerate the current list.

## Related Context

- `bench/DOCS.md` — shared eval primitives and reporting boundary
- `packages/agent/` — the library these evals exercise
- `packages/agent/DOCS.md` — library architecture overview
