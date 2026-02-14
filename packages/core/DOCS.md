# @agents/core

Core agent primitives. See `VISION.md` for strategic rationale, `ROADMAP.md` for the plan.

## Architecture

The library provides stable abstractions (traits/interfaces) and default implementations. Consumers compose them freely or supply their own via Effect Layers.

**Core primitives** (all in `src/`):

- **Sandbox** (`src/sandbox/`) — execution environment trait for tools. Ships `LocalSandbox`. `CurrentSandbox` tag provides the per-scenario session to tool handlers via `R`.
- **Tool** (`src/tool/`) — `@effect/ai Toolkit` tools that delegate to `CurrentSandbox`. Ships `ReadFile`. Handlers use `failureMode: "return"` so errors go back to the LLM.
- **Harness** (`src/harness/`) — system prompt + tools + hooks = agent. Agent loop with multi-turn tool calling. Memory is a harness concern (hooks), not a separate primitive.

**Evaluation primitives** live in `@agents/bench`: `eval_()`, `run()`, Reporter.

**Execution model**: Three distinct contexts — orchestrator, agent runtime (harness), and sandbox. The harness runs outside the sandbox so a broken environment doesn't kill the agent loop. See `VISION.md` and `src/sandbox/DOCS.md`.

**Key design decisions**:

- Tools ARE @effect/ai `Toolkit` tools — no abstraction layer
- Everything is plain data + functions, no classes/inheritance
- Dependencies flow through Effect's `R` parameter, satisfied via Layers at the edge
- Sub-path `exports` in `package.json` for granular imports
- Sandbox is a factory (`SandboxFactory`).
- IaC lives in userland — it provisions resources that satisfy `SandboxFactory` Layers

## Related Context

- `src/sandbox/` — Sandbox service, CurrentSandbox tag, and LocalSandbox layer
- `src/tool/` — Agent tools (ReadFile) and bundled toolkit
- `src/harness/` — Harness config, hooks, and run function (multi-turn agent loop)
- `packages/bench/` — eval primitives (`eval_`, `run`, Reporter)
- `VISION.md` — strategic rationale, execution model, industry context
- `ROADMAP.md` — phased plan from current state to production
