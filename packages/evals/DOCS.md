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

## Files

- `cli.ts` — `@effect/cli` entrypoint: `list` and `run` commands
- `suite.ts` — `EvalSuite` interface contract
- `registry.ts` — static registry mapping names to suites
- `hello-world/` — trivial prompt/response eval (no tools)
- `file-edit/` — agentic eval: ReadFile + EditFile with hashline anchors
- `write-file/` — agentic eval: WriteFile creates files (text, JSON, nested paths)
- `glob/` — agentic eval: Glob finds files by pattern
- `grep/` — agentic eval: Grep searches file contents by regex pattern

## Related Context

- `packages/agent/` — the library these evals exercise
- `packages/agent/DOCS.md` — library architecture overview
