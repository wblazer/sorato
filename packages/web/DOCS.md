# @agents/web

SvelteKit web interface for the agents system.

## Architecture

Static SPA mode (`adapter-static`) with no SSR. All state lives in the browser with optional server persistence.

## Connection Management

The app supports multiple server connections with runtime switching:

- **Storage**: `packages/web/src/lib/storage.ts` — localStorage abstraction, ready for electron-store
- **State**: `packages/web/src/lib/stores/connections.svelte.ts` — persisted connection list with timestamps
- **UI**: Connection status badge in sidebar bottom-left, popover for server switching
- **Handshake**: Validates server reachability via `/handshake` endpoint

### Features

- Add/edit/delete connections
- Live URL validation with green/red indicator
- Auto-sorted by last used
- Empty state prompts for first connection
- Immediate switch when clicking a server

### Usage

```typescript
import { connectionsStore } from '$lib/stores/connections.svelte.js'

// All connections sorted by lastUsedAt
connectionsStore.connections

// Currently active connection
connectionsStore.activeConnection

// Get API base for fetch calls
connectionsStore.getApiBase() // 'http://localhost:3100' or ''

// Add new connection
connectionsStore.add({ url: 'http://localhost:3100', name: 'Local' })

// Switch active
connectionsStore.activate(connectionId)
```

## Stores

- `connections.svelte.ts` — Server connections (client state)
- `sessions.svelte.ts` — Session list, directory tree
- `messages.svelte.ts` — Chat messages, streaming content
- `sse.svelte.ts` — Global SSE connection
- `hotkeys.svelte.ts` — TanStack hotkeys wrapper

## Components

- `connection-manager.svelte` — Server selector popover
- `connection-dialog.svelte` — Add/edit server modal
- `no-connections.svelte` — Empty state screen

## Development

```bash
bun run dev        # Vite dev server
bun run build      # Static build to build/
bun run check      # svelte-check
```

## Future: Electron

The storage abstraction (`storage.ts`) and SPA mode make this trivial to wrap in Electron. The desktop app will:

1. Load same built files
2. Swap storage to `electron-store`
3. Optionally spawn bundled server subprocess
4. Expose `coupledServerUrl` to renderer for auto-connect
