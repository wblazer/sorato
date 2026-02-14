# @blazerbench/core

The library. Composable primitives for building and benchmarking AI agent systems. See `VISION.md` for strategic rationale, `ROADMAP.md` for the plan.

## Architecture

The library provides stable abstractions (traits/interfaces) and default implementations. Consumers compose them freely or supply their own via Effect Layers. Benchmarking is one use case; the same primitives support building real agent systems.

**Primitives** (all in `src/`):

- **Dataset** (`src/dataset/`) — collection of scenarios. Effectful loading. Generic over everything.
- **Rubric** (`src/rubric/`) — evaluates harness output against expectations. Ships built-in rubrics; write your own.
- **Sandbox** (`src/sandbox/`) — execution environment trait for tools. Ships `LocalSandbox`. The agent loop runs _outside_ the sandbox — tool calls are remoted in.
- **Harness** (`src/harness/`) — system prompt + tools + hooks = agent. Memory is a harness concern (hooks), not a separate primitive.
- **Runner** (`src/runner/`) — batch-mode orchestration: dataset → harness → rubric → results. Other execution patterns are userland.
- **Reporter** (`src/reporter/`) — formats and persists benchmark results.

**Data flow** (benchmark mode): `Dataset.scenarios` → `Harness.run(input)` → `Rubric.evaluate(RunContext)` → `BenchmarkResult`

**Execution model**: Three distinct contexts — orchestrator, agent runtime (harness), and sandbox. The harness runs outside the sandbox so a broken environment doesn't kill the agent loop. See `VISION.md` and `src/sandbox/DOCS.md`.

**Key design decisions**:

- Tools ARE @effect/ai `Toolkit` tools — no abstraction layer
- Everything is plain data + functions, no classes/inheritance
- Dependencies flow through Effect's `R` parameter, satisfied via Layers at the edge
- Sub-path `exports` in `package.json` for granular imports
- Rubrics receive a full `RunContext` (sandbox + conversation + scenario + usage), NOT just strings
- Sandbox is a factory (`SandboxFactory`). Runner acquires a scoped session per scenario.
- IaC lives in userland — it provisions resources that satisfy `SandboxFactory` Layers

## Related Context

- `src/dataset/` — Dataset and Scenario types
- `src/rubric/` — Rubric trait and built-in implementations
- `src/sandbox/` — Sandbox service and LocalSandbox layer
- `src/harness/` — Harness config, hooks, and run function
- `src/runner/` — Runner orchestration and result types
- `src/reporter/` — Result formatting and persistence
- `VISION.md` — strategic rationale, execution model, industry context
- `ROADMAP.md` — phased plan from current state to production
