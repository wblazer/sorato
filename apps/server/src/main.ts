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
import { SqliteSession } from '@agents/core'
import { Api } from './Api.js'
import { SessionsLive } from './Sessions.js'

// ── Data directory ──────────────────────────────────────────────────

const dataDir =
  process.env.AGENTS_DATA_DIR ??
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'agents'
  )

// ── Compose layers ──────────────────────────────────────────────────

const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide(SessionsLive))

const StorageLive = SqliteSession({ path: join(dataDir, 'sessions.db') })

// ── Serve ───────────────────────────────────────────────────────────

const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(ApiLive),
  Layer.provide(StorageLive),
  Layer.provide(BunHttpServer.layer({ port: 3100 }))
)

Layer.launch(HttpLive).pipe(BunRuntime.runMain)
