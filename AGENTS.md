# Blazer Bench

Composable primitives for building and benchmarking AI agent systems. See `VISION.md` for the strategic rationale.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Effect (functional programming)
- **CLI**: @effect/cli
- **AI**: @effect/ai

## Agent Map

**The Vision**: As codebases grow, LLMs struggle to navigate without flooding context windows. This project uses a distributed "agent map" - AGENTS.md files placed throughout the codebase that act as navigation nodes. Each node answers "why does this code exist" and "how do I work with it" without requiring full codebase context.

**How the Map Works**:

- Each AGENTS.md has links (file paths) to related nodes (e.g., `src/components/AGENTS.md`)
- When you read any file in a directory, all AGENTS.md files up the tree are automatically loaded
- Jump to any AGENTS.md and you'll have full context for that location

**Map Documentation Philosophy**:

- **Locality of concern**: explanations belong next to the code they describe, not in a separate doc. AGENTS.md nodes summarize _folders_, not files. Type explanations go in comments next to the type.
- AGENTS.md nodes explain "why" for folders/modules existence — the domain knowledge that normally gets lost over time
- Nodes point to files with brief descriptions. Details live in the code — go read it.
- Document architectural boundaries and "never do this" rules
- Don't duplicate what the code already says. Docs that restate code will drift and become lies.

## Architecture

Composable primitives. The library provides the structure and some default implementations; consumers compose them freely or supply their own. Benchmarking is one use case of the composition, not the only one — the same primitives support building real agent systems.

**Primitives** (all in `src/`):

- **Dataset** (`src/dataset/`) — collection of `Scenario<Input, Expected, Meta>`. Effectful loading. Generic over everything.
- **Rubric** (`src/rubric/`) — evaluates harness output against expected. Ships: `exactMatch`, `contains`, `regex`, `llmJudge`. Write your own with `fromFunction` / `fromEffect`.
- **Sandbox** (`src/sandbox/`) — execution environment trait for tools. Ships `LocalSandbox` (no isolation). Consumers provide Docker/Firecracker/etc. as a Layer. The agent loop runs _outside_ the sandbox — tool calls are remoted in.
- **Harness** (`src/harness/`) — composes tools (via @effect/ai `Toolkit`), hooks, and a system prompt. The "agent under test." Memory is a harness concern (hooks), not a separate primitive.
- **Runner** (`src/runner/`) — orchestrates: dataset → harness → rubric → results. Configurable concurrency. This is batch-mode composition; other execution patterns (webhook-triggered, interactive) are userland.
- **Reporter** (`src/reporter/`) — formats and persists benchmark results. Console summary + JSON serialization.

**Data flow** (benchmark mode): `Dataset.scenarios` → `Harness.run(input)` → `Rubric.evaluate(RunContext)` → `BenchmarkResult`

**Execution model**: Three distinct contexts — orchestrator (your CLI/server), agent runtime (harness/LLM loop), and sandbox (isolated tool execution). The harness runs outside the sandbox so a broken environment doesn't kill the agent loop. See `VISION.md` and `src/sandbox/AGENTS.md` for details.

**Key design decisions**:

- Tools ARE @effect/ai `Toolkit` tools — no abstraction layer
- Everything is plain data + functions, no classes/inheritance
- Dependencies flow through Effect's `R` parameter, satisfied via Layers at the edge
- `package.json` has sub-path `exports` for future publishability
- Rubrics receive a `RunContext` (sandbox + conversation + scenario + usage), NOT just strings. This supports evaluating full agent loops — e.g. a coding rubric can `sandbox.exec("bun test")` to check correctness. String comparison is a special case handled by built-in rubrics that extract the final assistant message.
- Sandbox is a _factory_ (`SandboxFactory`), not a singleton. The Runner acquires a scoped `SandboxSession` per scenario — no cross-contamination, proper cleanup, safe for concurrent runs.
- Scenarios have stable `id` fields for diffing results across runs, caching, and retry tracking.
- `exec` returns `{ stdout, stderr, exitCode }` — rubrics can check exit codes, not just stdout.
- IaC (Alchemy, Terraform, Nix, etc.) lives in userland — it provisions resources that satisfy `SandboxFactory` Layers. The library is agnostic to cloud providers and provisioning tools.

## Related Context

- `src/dataset/` — Dataset and Scenario types
- `src/rubric/` — Rubric trait and built-in implementations
- `src/sandbox/` — Sandbox service and LocalSandbox layer
- `src/harness/` — Harness config, hooks, and run function
- `src/runner/` — Runner orchestration and result types
- `src/reporter/` — Result formatting and persistence

## Development Commands

```bash
# Type check
bun run typecheck

# Run the CLI
bun run start

# Install dependencies
bun install
```

## Never Do

- Never bypass Effect's type system with `any` or `unknown` casts
- Never use synchronous file I/O - always use Effect's async primitives

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

<!-- effect-solutions:end -->

## Code Philosophy

### Cognitive Load is What Matters

We should reduce the cognitive load in our projects as much as possible.

When reading code, you put things like values of variables, control flow logic and call sequences into your head. The average person can hold roughly four such chunks in working memory. Once the cognitive load reaches this threshold, it becomes much harder to understand things.

Types of cognitive load:

- Intrinsic - caused by the inherent difficulty of a task. It can't be reduced, it's at the very heart of software development.
- Extraneous - created by the way the information is presented. Caused by factors not directly relevant to the task, such as smart author's quirks. Can be greatly reduced.

Our goal is to reduce extraneous cognitive load as much as possible.
Patterns that contribute to extraneous cognitive load:

- Complex inline conditionals
  - Solution: introduce meaningfully named intermediate variables
- Nested ifs
  - Solution: early returns
- Inheritance, e.g. AdminController extends UserController extends GuestController extends BaseController
  - Solution: prefer composition over inheritance
- Excessive state
  - Solution: prefer functional style programming - describe the series of computations to be performed, avoid storing the state at each step if possible. Also break down scopes with excessive state into composable functions to compartmentalize the cognitive load

### Single Source of Truth

I hope this one is self explanatory. Duplicate sources of truth for the same information drift over time, leading to confusion and bugs. This is why the agent map is so important - it helps us find pre-existing sources of truth so that we can avoid repeating it.

Just because two sources of information match at any one point in time does not mean that they should be consolidated. Sometimes, they could become meaningfully different in the future. You must think in terms of the problem space, not the current state of the solution. For example, two API endpoints may return the same response schema _right now_ but they are fundamentally _different endpoints_, so the response types should be declared separately.
