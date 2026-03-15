# Server

The local HTTP boundary for `@agents/agent`.

This folder exists to adapt the library primitives to a long-lived local server process: typed HTTP endpoints, live event streaming, and in-memory coordination for active runs. If you are changing how the browser or another client talks to the agent, start here.

## What Belongs Here

- Add code here when the change is about transport or server-owned runtime state: HTTP routes, SSE delivery, run lifecycle coordination, or local-dev process behavior.
- Do not put core agent-loop logic here. If the change should also make sense in evals or a non-HTTP embedding, it probably belongs in `src/harness/`, `src/session/`, or `src/tool/` instead.

## Architectural Boundaries

- `api.ts` defines the typed HTTP surface. Add or change schemas here when the wire contract changes.
- `sessions.ts` and `directories.ts` implement the API groups. Add endpoint behavior there, not in `main.ts`.
- `run-agent.ts` owns one server-triggered run: persist the new user turn, acquire the sandbox, invoke the harness, publish lifecycle events, and finish cleanly.
- `run-persistence.ts` is where a completed run becomes durable session history.
- `event-bus.ts`, `run-registry.ts`, `event-replay.ts`, and `sse.ts` are the live-runtime side: who is running, what events exist for the active run, and how clients catch up.
- `agent-config.ts` is the default server-side agent profile. Keep request orchestration out of it.
- `main.ts` is composition only. It should wire layers and middleware together, not accumulate feature logic.

## Local-Dev Assumptions

- Runtime state in this folder is intentionally in-memory and process-local. Active runs, stop semantics, and SSE replay are for one local server process, not a distributed deployment.
- Persistent conversation state lives in `SessionStorage`. If a fact must survive restart, it does not belong in the live runtime modules here.

## Never Do

- Never move reusable agent behavior into the server just because the web app needs it once.
- Never mix durable session state with live run bookkeeping in the same module.
- Never bypass the event bus for streaming concerns; SSE replay and live delivery depend on a single event flow.

## Related Context

- `../harness/` — the agent loop the server invokes
- `../session/` — persistent conversation storage
- `../sandbox/` — scoped execution environment for each run
- `../../DOCS.md` — package-level architecture and execution model
- `../../../web/DOCS.md` — browser client that consumes this server
