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
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/unstable/http'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { SqliteSession } from '../index.ts'
import { Api } from './api.ts'
import { AgentLive } from './agent-config.ts'
import { DirectoriesLive } from './directories.ts'
import { SessionsLive } from './sessions.ts'
import { withSse } from './sse.ts'

import { HandshakeResponse } from './api.ts'

// ── Data directory ──────────────────────────────────────────────────

const dataDir =
  process.env.AGENTS_DATA_DIR ??
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'agents'
  )

// ── Compose layers ──────────────────────────────────────────────────

const HandshakeLive = HttpApiBuilder.group(Api, 'handshake', (handlers) =>
  handlers.handle('check', () =>
    Effect.succeed(new HandshakeResponse({ version: '0.0.1', status: 'ok' }))
  )
)

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(SessionsLive),
  Layer.provide(DirectoriesLive),
  Layer.provide(HandshakeLive)
)

const StorageLive = SqliteSession({ path: join(dataDir, 'sessions.db') })

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
  Layer.provide(StorageLive),
  Layer.provide(AgentLive),
  Layer.provide(HttpRouter.layer),
  Layer.provide(BunHttpServer.layer({ port: 3100 }))
)

Layer.launch(HttpLive).pipe(BunRuntime.runMain)
