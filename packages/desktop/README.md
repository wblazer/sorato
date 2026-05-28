# @sorato/desktop

Electron shell for the Sorato SvelteKit frontend.

## Development

Run the local API server separately:

```bash
bun run server
```

Then launch Electron + the web dev server:

```bash
bun run desktop
```

The preload exposes `window.soratoDesktop.getBootstrap()`, which currently points the frontend at `SORATO_SERVER_URL` or `http://localhost:3100`.
