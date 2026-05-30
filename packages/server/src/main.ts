/**
 * Server entry point.
 *
 * Composes the API layer with SessionStorage (SQLite) and serves via Effect Platform.
 *
 * Data path resolution:
 *   SORATO_DATA_DIR env var > XDG_DATA_HOME/sorato > ~/.local/share/sorato
 */
import { dirname, join } from 'node:path'
import { Command, GlobalFlag } from 'effect/unstable/cli'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/unstable/http'
import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { Effect, FileSystem, Layer, Option } from 'effect'
import { Api } from './api.ts'
import { AgentLive } from './agent-config.ts'
import { AuthLive } from './auth.ts'
import { DirectoriesLive } from './directories.ts'
import { LoggingLive, resolveLogFile, resolveLogLevel } from './logging.ts'
import { ModelsLive } from './models.ts'
import { ProjectsLive } from './projects.ts'
import { RuntimeConfigLive } from './runtime-config.ts'
import { SessionsLive } from './sessions.ts'
import { SseLive } from './sse.ts'
import { dataDir } from './data-dir.ts'
import { SqliteProviderAuthStore } from './provider-auth.ts'
import { SqliteProject } from './project/sqlite-project.ts'
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
  Layer.provide(ProjectsLive),
  Layer.provide(SessionsLive),
  Layer.provide(DirectoriesLive),
  Layer.provide(ModelsLive),
  Layer.provide(AuthLive),
  Layer.provide(HandshakeLive)
)

const sessionsDbPath = join(dataDir, 'sessions.db')
const providerAuthDbPath = join(dataDir, 'server.db')

const SqliteClientLive = (filename: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(dirname(filename), { recursive: true })
      return SqliteClient.layer({ filename })
    })
  )

const SessionStorageLive = SqliteSession({ path: sessionsDbPath })
const ProjectStorageLive = SqliteProject
const StorageLive = Layer.merge(SessionStorageLive, ProjectStorageLive).pipe(
  Layer.provide(SqliteClientLive(sessionsDbPath))
)
const ProviderAuthLive = SqliteProviderAuthStore({
  path: providerAuthDbPath,
}).pipe(Layer.provide(SqliteClientLive(providerAuthDbPath)))

// ── Serve ───────────────────────────────────────────────────────────

const AppLive = Layer.merge(ApiLive, SseLive)

const HttpLive = HttpRouter.toHttpEffect(AppLive).pipe(
  Effect.map((app) =>
    HttpServer.serve(app, (httpApp) =>
      HttpMiddleware.cors()(HttpMiddleware.logger(httpApp))
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

const server = Command.make('sorato-server', {}, () =>
  Effect.gen(function* () {
    const cliLogLevel = yield* GlobalFlag.LogLevel
    const resolvedLogLevel = yield* resolveLogLevel(
      Option.getOrUndefined(cliLogLevel)
    )

    return yield* Effect.logInfo('Logging configured', {
      logLevel: resolvedLogLevel,
      logFile: resolveLogFile(),
    }).pipe(
      Effect.andThen(Layer.launch(HttpLive)),
      Effect.provide(LoggingLive(resolvedLogLevel)),
      Effect.annotateLogs({ package: 'server', subsystem: 'startup' })
    )
  })
).pipe(Command.withDescription('Run the local Sorato HTTP server'))

Command.run(server, { version: '0.0.1' }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
