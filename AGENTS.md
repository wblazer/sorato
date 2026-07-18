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

## Reference Repos

`.reference/` holds read-only clones of upstream projects for consulting real-world source and drawing inspiration. They are gitignored; the pinned refs live in `.reference/manifest.json`. If the directory is missing or stale, run `bun run reference:sync` (see `scripts/sync-reference.ts`).

- `effect-v4` — Effect's own source (effect-smol), pinned to the version we use; the canonical reference for Effect APIs, internals, and idioms.
- `pi` — Minimal, extensible agent harness. Reference for plugin system and harness patterns
- `opencode` — Agent harness with very similar client/server architecture. In the process of adopting Effect. Reference for Effect and harness design patterns.
- `codex` — OpenAI's Codex. Reference for frontier lab coding agent.
- `t3code` — Web GUI for interacting with other harnesses like Claude Code, Codex, and OpenCode. High quality Effect codebase and Electron app.
- `alchemy-effect` — Alchemy, infrastructure-as-Effect; reference for structuring services, layers, and resource lifecycles in Effect. Also reference for using Alchemy for deploying resources.
- `distilled` — Effect-native cloud provider SDKs with exhaustive error typing, retry policies, and streaming pagination; reference for Effect patterns.

## Development Commands

```bash
# These must all pass
bun run typecheck
bun run test
bun run lint
bun run format
bun run effect:diagnostics

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

## Effect Best Practices

**IMPORTANT:** Always load the project-local `effect` skill before writing or
reviewing Effect code, then read every reference branch that matches the task.

Project conventions and specialized project-local skills take precedence over
generic guidance. For API details, verify against the installed packages and
the matching source in `.reference/effect-v4/`; never guess at Effect APIs.

The Effect skill's scheduling guide was authored across a beta API transition.
For Effect 4.0.0-beta.99, use `Schedule.tap(({ input }) => ...)`, not the
removed `Schedule.tapInput(...)`.

### Breaking Changes

This code is greenfield, breaking changes are fine. Do not let the cruft of the past dictate this codebase's future.
