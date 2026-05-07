/**
 * Server entry point.
 *
 * Composes the API layer with SessionStorage (SQLite) and serves via Effect Platform.
 *
 * Data path resolution:
 *   AGENTS_DATA_DIR env var > XDG_DATA_HOME/agents > ~/.local/share/agents
 */
import { join } from 'node:path'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/unstable/http'
import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { Effect, Layer } from 'effect'
import { Api } from './api.ts'
import { AgentLive } from './agent-config.ts'
import { AuthLive } from './auth.ts'
import { DirectoriesLive } from './directories.ts'
import { ModelsLive } from './models.ts'
import { RuntimeConfigLive } from './runtime-config.ts'
import { SessionsLive } from './sessions.ts'
import { withSse } from './sse.ts'
import { dataDir } from './data-dir.ts'
import { SqliteProviderAuthStore } from './provider-auth.ts'
import { SqliteSession } from './session/sqlite-session.ts'

import { HandshakeResponse } from './api.ts'

// ── Data directory ──────────────────────────────────────────────────

// ── Compose layers ──────────────────────────────────────────────────

const HandshakeLive = HttpApiBuilder.group(Api, 'handshake', (handlers) =>
  handlers.handle('check', () =>
    Effect.succeed(new HandshakeResponse({ version: '0.0.1', status: 'ok' }))
  )
)

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(SessionsLive),
  Layer.provide(DirectoriesLive),
  Layer.provide(ModelsLive),
  Layer.provide(AuthLive),
  Layer.provide(HandshakeLive)
)

const sessionsDbPath = join(dataDir, 'sessions.db')
const providerAuthDbPath = join(dataDir, 'server.db')

const StorageLive = SqliteSession({ path: sessionsDbPath }).pipe(
  Layer.provide(SqliteClient.layer({ filename: sessionsDbPath }))
)
const ProviderAuthLive = SqliteProviderAuthStore({ path: providerAuthDbPath }).pipe(
  Layer.provide(SqliteClient.layer({ filename: providerAuthDbPath }))
)

// ── Serve ───────────────────────────────────────────────────────────

const HttpLive = HttpRouter.toHttpEffect(ApiLive).pipe(
  Effect.map((app) =>
    HttpServer.serve(
      app,
      withSse((httpApp) =>
        HttpMiddleware.cors()(HttpMiddleware.logger(httpApp))
      )
    )
  ),
  Layer.unwrap,
  HttpServer.withLogAddress,
  Layer.provide(RuntimeConfigLive),
  Layer.provide(StorageLive),
  Layer.provide(ProviderAuthLive),
  Layer.provide(AgentLive),
  Layer.provide(HttpRouter.layer),
  Layer.provide(BunServices.layer),
  Layer.provide(BunHttpServer.layer({ port: 3100 }))
)

Layer.launch(HttpLive).pipe(BunRuntime.runMain)
