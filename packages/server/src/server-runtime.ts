import { dirname, join } from 'node:path'
import { Command, GlobalFlag } from 'effect/unstable/cli'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/unstable/http'
import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { Config, Effect, FileSystem, Layer, Option } from 'effect'
import { Api, HandshakeResponse } from '@sorato/api'
import { AgentLive, AllToolInfos } from './agent-config.ts'
import { AuthLive } from './auth.ts'
import { DirectoriesLive } from './directories.ts'
import { LoggingLive, resolveLogFile, resolveLogLevel } from './logging.ts'
import { LanguageModelResolver, ModelCatalog } from './model-catalog.ts'
import { ModelsLive } from './models.ts'
import { ProjectsLive } from './projects.ts'
import { RuntimeConfigLive } from './runtime-config.ts'
import { SessionsLive } from './sessions.ts'
import { EventBusLive } from './event-bus.ts'
import { EventsLive } from './sse.ts'
import { dataDir } from './data-dir.ts'
import { makeSqlitePersistenceLive } from './db/sqlite.ts'
import { SqliteProviderAuthStore } from './provider-auth.ts'
import { SqliteProject } from './project/sqlite-project.ts'
import { SqliteSession } from './session/sqlite-session.ts'

export interface ServerRuntimeOptions {
  readonly developerMode: boolean
  readonly modelCatalog: Layer.Layer<ModelCatalog>
  readonly languageModelResolver: Layer.Layer<LanguageModelResolver>
}

const handshakeLive = (developerMode: boolean) =>
  HttpApiBuilder.group(Api, 'handshake', (handlers) =>
    handlers.handle('check', () =>
      Effect.succeed(
        HandshakeResponse.make({
          version: '0.0.1',
          status: 'ok',
          tools: [...AllToolInfos],
          developerMode,
        })
      )
    )
  )

const apiLive = (developerMode: boolean) =>
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(ProjectsLive),
    Layer.provide(SessionsLive),
    Layer.provide(DirectoriesLive),
    Layer.provide(ModelsLive),
    Layer.provide(AuthLive),
    Layer.provide(handshakeLive(developerMode)),
    Layer.provide(EventsLive)
  )

const sessionsDbPath = join(dataDir, 'sessions.db')
const providerAuthDbPath = join(dataDir, 'server.db')
const databaseLockPath = join(dataDir, 'database.lock')

const acquireDatabaseLock = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(dataDir, { recursive: true })

  const acquire = fs.writeFileString(databaseLockPath, `${process.pid}\n`, {
    flag: 'wx',
  })

  yield* acquire.pipe(
    Effect.catch((error) =>
      error.reason._tag !== 'AlreadyExists'
        ? Effect.fail(error)
        : Effect.gen(function* () {
            const owner = yield* fs.readFileString(databaseLockPath)
            const pid = Number.parseInt(owner.trim(), 10)
            const ownerIsRunning =
              Number.isSafeInteger(pid) &&
              pid > 0 &&
              (() => {
                try {
                  process.kill(pid, 0)
                  return true
                } catch {
                  return false
                }
              })()

            if (ownerIsRunning) return yield* Effect.fail(error)

            yield* fs.remove(databaseLockPath, { force: true })
            return yield* acquire
          })
    )
  )
})

const withDatabaseLock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    acquireDatabaseLock,
    () => effect,
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.remove(databaseLockPath, { force: true })
      }).pipe(Effect.orDie)
  )

const sqliteClientLive = (filename: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(dirname(filename), { recursive: true })
      return SqliteClient.layer({ filename })
    })
  )

const sessionStorageLive = SqliteSession({ path: sessionsDbPath })
const storageLive = Layer.merge(sessionStorageLive, SqliteProject).pipe(
  Layer.provide(makeSqlitePersistenceLive({ filename: sessionsDbPath }))
)
const providerAuthLive = SqliteProviderAuthStore({
  path: providerAuthDbPath,
}).pipe(Layer.provide(sqliteClientLive(providerAuthDbPath)))

const serverHost = Config.string('SORATO_SERVER_HOST').pipe(
  Config.withDefault('127.0.0.1')
)
const serverPort = Config.int('SORATO_SERVER_PORT').pipe(
  Config.withDefault(3100)
)

const httpLive = (options: ServerRuntimeOptions) =>
  HttpRouter.toHttpEffect(apiLive(options.developerMode)).pipe(
    Effect.map((app) =>
      HttpServer.serve(app, (httpApp) =>
        HttpMiddleware.cors()(HttpMiddleware.logger(httpApp))
      )
    ),
    Layer.unwrap,
    HttpServer.withLogAddress,
    Layer.provide(options.languageModelResolver),
    Layer.provide(options.modelCatalog),
    Layer.provide(RuntimeConfigLive),
    Layer.provide(EventBusLive),
    Layer.provide(storageLive),
    Layer.provide(providerAuthLive),
    Layer.provide(AgentLive),
    Layer.provide(HttpRouter.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      BunHttpServer.layerConfig({ hostname: serverHost, port: serverPort })
    )
  )

export const runServer = (options: ServerRuntimeOptions) => {
  const server = Command.make('sorato-server', {}, () =>
    Effect.gen(function* () {
      const cliLogLevel = yield* GlobalFlag.LogLevel
      const resolvedLogLevel = yield* resolveLogLevel(
        Option.getOrUndefined(cliLogLevel)
      )

      return yield* Effect.logInfo('Logging configured', {
        logLevel: resolvedLogLevel,
        logFile: resolveLogFile(),
        developerMode: options.developerMode,
      }).pipe(
        Effect.andThen(Layer.launch(httpLive(options))),
        withDatabaseLock,
        Effect.provide(LoggingLive(resolvedLogLevel)),
        Effect.annotateLogs({ package: 'server', subsystem: 'startup' })
      )
    })
  ).pipe(Command.withDescription('Run the local Sorato HTTP server'))

  Command.run(server, { version: '0.0.1' }).pipe(
    Effect.provide(BunServices.layer),
    BunRuntime.runMain
  )
}
