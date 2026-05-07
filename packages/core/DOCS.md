# @sorato/core

Reusable agent runtime primitives. This package answers "how does an agent run?" without owning product/session/server concerns.

## Architecture

- `src/harness/` — the agent loop, lifecycle events, and hooks.
- `src/sandbox/` — execution boundary with `Shell` and `Files` services.
- `src/tool/` — `@effect/ai Toolkit` tool declarations and handlers backed by sandbox services.

## Boundary

Core consumes a provided `LanguageModel` and emits lifecycle events through hooks. It does not know about HTTP, SSE, persistent sessions, model availability, provider auth, or browser clients.

## Related Context

- `../server/` — coordinator that persists sessions, resolves models, streams events, and invokes core.
- `../web/` — browser client for the server.
