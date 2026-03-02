/**
 * Server entry point.
 *
 * Composes the API layer with SessionStorage (SQLite) and serves via Bun.
 *
 * Data path resolution:
 *   AGENTS_DATA_DIR env var > XDG_DATA_HOME/agents > ~/.local/share/agents
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { HttpApiBuilder, HttpMiddleware, HttpServer } from '@effect/platform'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Layer } from 'effect'
import { SqliteSession } from '../index.ts'
import { AgentLive } from './Agent.ts'
import { Api } from './Api.ts'
import { DirectoriesLive } from './Directories.ts'
import { SessionsLive } from './Sessions.ts'
import { withSse } from './Sse.ts'

// ── Data directory ──────────────────────────────────────────────────

const dataDir =
  process.env.AGENTS_DATA_DIR ??
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'agents'
  )

// ── Compose layers ──────────────────────────────────────────────────

const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(SessionsLive),
  Layer.provide(DirectoriesLive)
)

const StorageLive = SqliteSession({ path: join(dataDir, 'sessions.db') })

// ── Serve ───────────────────────────────────────────────────────────

const HttpLive = HttpApiBuilder.serve(withSse(HttpMiddleware.logger)).pipe(
  HttpServer.withLogAddress,
  Layer.provide(HttpApiBuilder.middlewareCors()),
  Layer.provide(ApiLive),
  Layer.provide(StorageLive),
  Layer.provide(AgentLive),
  Layer.provide(BunHttpServer.layer({ port: 3100 }))
)

Layer.launch(HttpLive).pipe(BunRuntime.runMain)
