# Blazer Bench
A personal LLM benchmarking tool with a focus on modularity and composability

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
- Code should be as self-documenting as possible; the agent map compresses the code for context efficiency
- AGENTS.md nodes explains "why" for folders/modules existence - the domain knowledge you have when writing code that normally gets lost over time
- Document architectural boundaries
- Include common pitfalls and "never do this" rules specific to that code
- Implementation details in AGENTS.md should be rare - mostly for "here's what a typical {sensible_code_unit} looks like"
- If relevant, nodes should document usage by consumers for convenience. Think like quick example showcases at the top of READMEs, except for code

## Related Context

*This section will grow as the project develops. Each entry links to an AGENTS.md node.*

*Current structure is minimal - no child nodes yet.*

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

Just because two sources of information match at any one point in time does not mean that they should be consolidated. Sometimes, they could become meaningfully different in the future. You must think in terms of the problem space, not the current state of the solution. For example, two API endpoints may return the same response schema *right now* but they are fundamentally *different endpoints*, so the response types should be declared separately.
