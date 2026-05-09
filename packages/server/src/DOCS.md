# Server

HTTP and live-runtime boundary for `@sorato/server`.

## Boundaries

- Transport, SSE, active runs, and local server process state belong here.
- Reusable agent behavior belongs in `@sorato/core`.
- Durable conversation state belongs in `session/`.
- `main.ts` should compose layers and middleware, not accumulate feature logic.

## Pointers

- `api.ts` - typed wire contract
- `sessions.ts`, `directories.ts`, `models.ts` - API groups
- `run-agent.ts` - one server-triggered agent run
- `run-persistence.ts` - completed run persistence
- `event-bus.ts`, `run-registry.ts`, `event-replay.ts`, `sse.ts` - live run events
- `runtime-config.ts` - server-owned runtime defaults
- `provider-definitions.ts`, `provider-adapters.ts`, `model-catalog.ts` - model availability
- `session/DOCS.md` - persistent conversation storage
