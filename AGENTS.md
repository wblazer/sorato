# Sorato

A coding agent with tree-structured conversations, tracked side effects, and decoupled execution.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Effect
- **CLI**: @effect/cli
- **AI**: @effect/ai
- **Frontend**: SvelteKit

## Monorepo Structure

Bun workspaces. Packages depend on each other via `workspace:*`.

- `packages/core/` — reusable agent runtime: sandbox, tools, harness. See `packages/core/DOCS.md`.
- `packages/server/` — local coordinator/server: sessions, model availability, runtime config, SSE, HTTP. See `packages/server/DOCS.md`.
- `packages/web/` — web UI with multi-server connection management. See `packages/web/DOCS.md`.

## Development Commands

```bash
# These must all pass
bun run typecheck
bun run test
bun run lint
bun run format

bun run web
bun run server
```

## Naming Conventions

- Files and folders use kebab-case
- Exported classes, Effect services/tags, and schema types use PascalCase
- Functions, values, and store instances use camelCase

## Never Do

- Never bypass Effect's type system with `any` or `unknown` casts
- Never use synchronous file I/O - always use Effect's async primitives

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `bun run effect-solutions list` to see available guides
2. Run `bun run effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect-v4/` for real implementations. Start in `.reference/effect-v4/LLMs.md`

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

<!-- effect-solutions:end -->

### Breaking Changes

This code is greenfield, breaking changes are fine. Do not let the cruft of the past dictate this codebase's future.
