# @sorato/web

SvelteKit SPA for the local Sorato server.

## Boundaries

- `src/lib/stores/` owns browser state, fetching, SSE, and persistence coordination.
- `src/lib/components/` owns presentation and user interaction.
- Route files should stay thin.
- Multiple server connections are first-class; keep connection concerns centralized.

## Pointers

- `src/lib/stores/connections.svelte.ts` - active server connection
- `src/lib/stores/sessions.svelte.ts` - session list, selected session, run state
- `src/lib/stores/messages.svelte.ts` - active conversation and streaming turn
- `src/lib/stores/models.svelte.ts` - model availability and remembered preference
- `src/lib/stores/actions.svelte.ts` - action registry and hotkeys
