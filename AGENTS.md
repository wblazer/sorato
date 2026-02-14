# Agents

Composable primitives for building AI agent systems.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Effect (functional programming)
- **CLI**: @effect/cli
- **AI**: @effect/ai

## Monorepo Structure

Bun workspaces. Packages depend on each other via `workspace:*`.

- `packages/core/` — agent primitives (sandbox, harness, tool). See `packages/core/DOCS.md`.
- `packages/bench/` — evaluation primitives (dataset, rubric, runner, reporter). See `packages/bench/DOCS.md`.
- `apps/evals/` — benchmark eval suites that exercise the primitives
- `apps/` — future home for TUI, web UI, and other userspace applications

## Agent Map

**The Vision**: As codebases grow, LLMs struggle to navigate without flooding context windows. This project uses a distributed "agent map" — DOCS.md files placed throughout the codebase that act as navigation nodes. Each node answers "why does this code exist" and "how do I work with it" without requiring full codebase context.

**How the Map Works**:

- The root node is this file (`AGENTS.md`) — auto-loaded by OpenCode on every session
- Subdirectory nodes use `DOCS.md` — auto-loaded by a plugin (`docs-autoload`) when any file in that directory is read, or when the DOCS.md itself is read explicitly
- Each DOCS.md has links (file paths) to related nodes (e.g., `src/components/DOCS.md`)
- Explicit reads of a DOCS.md are deduplicated against subsequent autoloads — no double injection

**Map Documentation Philosophy**:

- **Locality of concern**: explanations belong next to the code they describe, not in a separate doc. DOCS.md nodes summarize _folders_, not files. Type explanations go in comments next to the type.
- DOCS.md nodes explain "why" for folders/modules existence — the domain knowledge that normally gets lost over time
- Nodes point to files with brief descriptions. Details live in the code — go read it.
- Document architectural boundaries and "never do this" rules
- Don't duplicate what the code already says. Docs that restate code will drift and become lies.

## Development Commands

```bash
# Type check all packages
bun run typecheck

# Install dependencies
bun install

# Run an eval
bun run --filter @agents/evals hello-world
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
