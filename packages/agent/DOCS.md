# @agents/agent

Core agent primitives. See `VISION.md` for strategic rationale, `ROADMAP.md` for the plan.

## Architecture

The library provides stable abstractions (traits/interfaces) and default implementations. Consumers compose them freely or supply their own via Effect Layers.

**Core primitives** (all in `src/`):

- **Sandbox** (`src/sandbox/`) — execution environment with fine-grained services: `Shell` (command execution) and `Files` (filesystem access). Tools declare dependencies on the specific services they need — `CurrentShell`, `CurrentFiles`, or both. Ships `LocalSandbox`.
- **Tool** (`src/tool/`) — `@effect/ai Toolkit` tools that delegate to sandbox services. Ships `ReadFile` + `EditFile` (hashline protocol), `Bash` (shell execution), `WriteFile` (file creation), and `Glob` (file pattern matching). Handlers use `failureMode: "return"` so errors go back to the LLM.
- **Harness** (`src/harness/`) — system prompt + tools + hooks = agent. Agent loop with multi-turn tool calling. Memory is a harness concern (hooks), not a separate primitive.
- **Session** (`src/session/`) — persistent conversation storage with tree-structured history. Messages form a tree via parent pointers (like git commits). Supports forking and branch switching. Ships `SqliteSession`.

**Evaluation primitives** live in `packages/evals/bench`: `test()`, `run()`, Reporter.

**Execution model**: Three distinct contexts — orchestrator, agent runtime (harness), and sandbox. The harness runs outside the sandbox so a broken environment doesn't kill the agent loop. See `VISION.md` and `src/sandbox/DOCS.md`.

**Key design decisions**:

- Tools ARE @effect/ai `Toolkit` tools — no abstraction layer
- Everything is plain data + functions, no classes/inheritance
- Dependencies flow through Effect's `R` parameter, satisfied via Layers at the edge
- Sub-path `exports` in `package.json` for granular imports
- Sandbox is a factory (`SandboxFactory`) that returns `{ shell, files }` — fine-grained services, unified lifecycle
- Tools depend on specific services (not a monolithic session) — a tool that only reads files doesn't carry a phantom shell dependency
- IaC lives in userland — it provisions resources that satisfy `SandboxFactory` Layers

## Related Context

- `src/sandbox/` — Sandbox factory, Shell/Files services, and LocalSandbox layer
- `src/tool/` — Agent tools: `ReadFile` + `EditFile` (hashline protocol), `Bash`
- `src/harness/` — Harness config, hooks, and run function (multi-turn agent loop)
- `src/session/` — Session storage: `SessionStorage` tag, `SqliteSession` layer, tree-structured messages
- `packages/evals/bench/` — eval primitives (`test`, `run`, Reporter)
- `VISION.md` — strategic rationale, execution model, industry context
- `ROADMAP.md` — phased plan from current state to production
