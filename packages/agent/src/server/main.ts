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
import { Effect, Layer } from 'effect'
import { SqliteSession } from '../index.ts'
import { Api } from './Api.ts'
import { AgentLive } from './agent-config.ts'
import { DirectoriesLive } from './Directories.ts'
import { SessionsLive } from './Sessions.ts'
import { withSse } from './Sse.ts'

import { HandshakeResponse } from './Api.ts'

// ── Data directory ──────────────────────────────────────────────────

const dataDir =
  process.env.AGENTS_DATA_DIR ??
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'agents'
  )

// ── Compose layers ──────────────────────────────────────────────────

const HandshakeLive = HttpApiBuilder.group(Api, 'handshake', (handlers) =>
  Effect.succeed(
    handlers.handle('check', () =>
      Effect.succeed(new HandshakeResponse({ version: '0.0.1', status: 'ok' }))
    )
  )
)

const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(SessionsLive),
  Layer.provide(DirectoriesLive),
  Layer.provide(HandshakeLive)
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
