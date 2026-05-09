# @sorato/core

Reusable agent runtime primitives.

Core runs agents with a provided `LanguageModel` and sandbox services. It does not own HTTP, SSE, persistent sessions, provider auth, model availability, or browser state.

## Pointers

- `src/harness/` - agent loop, lifecycle events, hooks
- `src/sandbox/` - execution boundary services
- `src/tool/` - toolkit declarations and handlers
