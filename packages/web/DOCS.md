# @sorato/web

SvelteKit SPA for the local Sorato server.

## Boundaries

- `src/lib/stores/` owns browser state, fetching, SSE, and persistence coordination.
- `src/lib/components/` owns presentation and user interaction.
- Route files should stay thin.
- Multiple server connections are first-class; keep connection concerns centralized.

## TypeScript Tooling

The web workspace keeps TypeScript 6 for `svelte-check`, which currently requires
the classic TypeScript JavaScript API. The repository compiler and Helix LSP use
TypeScript 7 through the root workspace installation.

## Data Fetching

- Use the shared `@sorato/api` `HttpApi` contract through `src/lib/api-client.ts`.
- Store actions that perform HTTP work should return `Effect`, not `Promise`.
- Run Effects only at UI/runtime boundaries with `Effect.runPromise` or `Effect.runPromiseExit`.
- Do not call raw `fetch` for Sorato API requests.
- Keep user-facing API error mapping centralized in `src/lib/api-client.ts` / `src/lib/api-errors.ts`.
- SSE is currently the exception: `/events` is consumed through `EventSource` in `src/lib/sse.ts` until it is modeled as an Effect `Stream` or shared API endpoint.

## Pointers

- `src/lib/stores/connections.svelte.ts` - active server connection
- `src/lib/stores/sessions.svelte.ts` - session list, selected session, run state
- `src/lib/stores/messages.svelte.ts` - active conversation and streaming turn
- `src/lib/stores/models.svelte.ts` - model availability and remembered preference
- `src/lib/stores/actions.svelte.ts` - action registry and hotkeys
