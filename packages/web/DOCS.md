# @agents/web

SvelteKit web interface for the agents system.

## Architecture

Static SPA mode (`adapter-static`) with no SSR. The browser owns UI state and treats the agent server as a remote API plus SSE event source.

## Where To Add Code

- Add code in `src/lib/stores/` when the change is about client-side state ownership, fetching, or SSE coordination.
- Add code in `src/lib/components/` when the change is about presentation or user interaction.
- Add code in `src/lib/storage.ts` when browser persistence needs to change.
- Avoid putting domain logic directly in route files; this package is organized around reusable stores and components.

## State Ownership

- `connections.svelte.ts` owns which server the browser is talking to.
- `sessions.svelte.ts` owns the session list, selected directory/session, and the app-wide view of run state.
- `messages.svelte.ts` owns the active session's message history and streaming turn content.
- `sse.svelte.ts` owns the app-lifetime global SSE connection for lightweight control-plane events.

That split matters: app-wide state lives in `sessions`, active-session streaming lives in `messages`. Keep those responsibilities separate so every store does not need to understand full chat streaming.

## Connection Model

- Multiple server connections are a first-class feature, not just a settings nicety.
- The app should always be able to switch servers at runtime without reload.
- Reachability checks belong to the connection flow, not scattered through feature stores.

## Future Desktop Wrapper

The package is intentionally browser-first but desktop-friendly. Keep browser persistence and server discovery abstract enough that an Electron wrapper can swap storage and optionally launch a bundled server process without rewriting feature code.

## Related Context

- `../agent/src/server/DOCS.md` — server-side transport and run lifecycle
- `../agent/DOCS.md` — core agent architecture

## Development

```bash
bun run dev        # Vite dev server
bun run build      # Static build to build/
bun run check      # svelte-check
```
