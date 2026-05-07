# @agents/server

Local coordinator/server for the agent product. See `VISION.md` for strategic rationale, `ROADMAP.md` for the plan.

## Architecture

The server depends on `@agents/core` for harness/sandbox/tools, then coordinates product concerns around it: HTTP, sessions, model availability, runtime config, SSE, and run lifecycle.

**HTTP Server** (`src/`) — Bun HTTP server exposing:

- `GET /handshake` — Connection validation (returns `{ version, status: 'ok' }`)
- `GET /models` — list usable models for a directory, filtered by runtime adapter support and local credentials
- Sessions API — create, list, get, delete, update session model, run agent, stop, message history
- Directories API — browse filesystem with `~` expansion
- SSE `/events` — streaming for session updates and run lifecycle

**Runtime config** — the server resolves optional defaults from `~/.config/agents/config.json(c)` and `<cwd>/.agents/config.json(c)`. It seeds `default_model` for new-session model selection and `title_model` for automatic first-message session titles without mutating existing sessions.

**Server session storage** (`src/session/`) — server-owned persistent conversation storage with tree-structured history. Messages form a tree via parent pointers (like git commits). Supports forking and branch switching. Ships `SqliteSession`. This is coordinator state, not core agent runtime.

**Model/provider architecture** — model metadata is generated from `models.dev`, but runtime support is owned locally:

- `src/provider-definitions.ts` is the source of truth for which providers we support and which model ids our runtime adapters recognize
- `src/provider-adapters.ts` maps supported providers to Effect `LanguageModel` layers and availability checks
- `src/model-catalog.ts` joins generated catalog data with adapter support and environment availability to decide what the UI can actually use

**Execution model**: Three distinct contexts — server coordinator, agent runtime (core harness), and sandbox. The harness runs outside the sandbox so a broken environment doesn't kill the agent loop.

## Related Context

- `../core/` — harness, sandbox, and tool primitives
- `src/session/` — Server-owned session storage: `SessionStorage` tag, `SqliteSession` layer, tree-structured messages
- `src/` — HTTP API: sessions, directories, handshake, SSE streaming
- `src/provider-definitions.ts` — shared supported-provider roster for generation and runtime
- `src/provider-adapters.ts` — runtime adapter registry for supported providers
- `src/model-catalog.ts` — available model filtering from generated catalog + adapter support
- `src/runtime-config.ts` — server-owned runtime config loading and merging
- `src/session-title.ts` — first-message session title generation with configured or cheap authenticated models
- `packages/web/` — Svelte web UI with connection management
- `VISION.md` — strategic rationale, execution model, industry context
- `ROADMAP.md` — phased plan from current state to production
