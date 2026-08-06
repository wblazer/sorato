import { BunRuntime, BunServices } from '@effect/platform-bun'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command, Flag, Prompt } from 'effect/unstable/cli'
import { Console, Data, Effect, FileSystem } from 'effect'

const version = '0.0.1'

class ProcessError extends Data.TaggedError('ProcessError')<{
  readonly command: string
  readonly message: string
  readonly cause?: Error
}> {}

class DatabaseResetError extends Data.TaggedError('DatabaseResetError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const runProcess = (command: string, args: ReadonlyArray<string>) =>
  Effect.callback<void, ProcessError>((resume) => {
    const child = spawn(command, [...args], {
      env: process.env,
      stdio: 'inherit',
    })

    child.once('error', (error) =>
      resume(
        Effect.fail(
          new ProcessError({ command, message: error.message, cause: error })
        )
      )
    )
    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      if (code === null || code === 0) {
        resume(Effect.void)
        return
      }

      resume(
        Effect.fail(
          new ProcessError({
            command,
            message: `${command} exited with code ${code}`,
          })
        )
      )
    })

    return Effect.sync(() => {
      if (!child.killed) child.kill()
    })
  })

const runDesktop = () => {
  const desktopBin = process.env.SORATO_DESKTOP_BIN?.trim()
  return desktopBin
    ? runProcess(desktopBin, [])
    : runProcess('bun', ['run', '--filter', '@sorato/desktop', 'start'])
}

const runServer = () => {
  const serverBin = process.env.SORATO_SERVER_BIN?.trim()
  return serverBin
    ? runProcess(serverBin, [])
    : runProcess('bun', ['run', '--filter', '@sorato/server', 'start'])
}

const dataDir =
  process.env.SORATO_DATA_DIR ??
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'sorato'
  )

const databaseLockPath = join(dataDir, 'database.lock')

type ResetScope = 'sessions' | 'credentials' | 'all'

const resetContents = {
  sessions: 'all projects, sessions, and conversation history',
  credentials: 'all saved API keys and OAuth credentials',
  all: 'all projects, sessions, conversation history, API keys, and OAuth credentials',
} as const satisfies Record<ResetScope, string>

const databaseNames = (scope: ResetScope): ReadonlyArray<string> => {
  switch (scope) {
    case 'sessions':
      return ['sessions.db']
    case 'credentials':
      return ['server.db']
    case 'all':
      return ['sessions.db', 'server.db']
  }
}

const acquireDatabaseLock = Effect.fn('Database.acquireResetLock')(
  function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(dataDir, { recursive: true })

    const acquire = fs.writeFileString(databaseLockPath, `${process.pid}\n`, {
      flag: 'wx',
    })

    return yield* acquire.pipe(
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

              if (ownerIsRunning) {
                return yield* new DatabaseResetError({
                  message:
                    'Sorato is running. Stop the desktop app and server before resetting the database.',
                })
              }

              yield* fs.remove(databaseLockPath, { force: true })
              return yield* acquire
            })
      ),
      Effect.mapError((error) =>
        error instanceof DatabaseResetError
          ? error
          : new DatabaseResetError({
              message: `Could not lock the Sorato database for reset: ${error.message}`,
              cause: error,
            })
      )
    )
  }
)

const resetDatabase = Effect.fn('Database.reset')(function* (
  scope: ResetScope,
  skipConfirmation: boolean
) {
  const fs = yield* FileSystem.FileSystem
  const confirmed = skipConfirmation
    ? true
    : yield* Prompt.confirm({
        message: `Delete ${resetContents[scope]}? This cannot be undone.`,
      })

  if (!confirmed) {
    return yield* Console.log('Database reset cancelled')
  }

  const databasePaths = databaseNames(scope).flatMap((filename) => {
    const path = join(dataDir, filename)
    return [path, `${path}-wal`, `${path}-shm`]
  })

  yield* Effect.acquireUseRelease(
    acquireDatabaseLock(),
    () =>
      Effect.gen(function* () {
        yield* Console.log(`Deleting ${resetContents[scope]} in ${dataDir}`)
        yield* Effect.forEach(
          databasePaths,
          (path) =>
            fs
              .remove(path, { force: true })
              .pipe(Effect.tap(() => Console.log(`removed ${path}`))),
          { concurrency: 'unbounded', discard: true }
        )
        yield* Console.log('done')
      }),
    () => fs.remove(databaseLockPath, { force: true }).pipe(Effect.orDie)
  )
})

const desktop = Command.make('desktop', {}, runDesktop).pipe(
  Command.withDescription('Open the desktop app')
)

const serve = Command.make('serve', {}, runServer).pipe(
  Command.withDescription('Run the local HTTP server')
)

const reset = Command.make(
  'reset',
  {
    scope: Flag.choice('scope', ['sessions', 'credentials', 'all']).pipe(
      Flag.withDefault('all'),
      Flag.withDescription('Choose which local data to delete')
    ),
    yes: Flag.boolean('yes').pipe(
      Flag.withDescription('Skip the destructive-action confirmation')
    ),
  },
  ({ scope, yes }) => resetDatabase(scope, yes)
).pipe(
  Command.withDescription(
    'Delete local session data, saved credentials, or both'
  )
)

const db = Command.make('db', {}, () => Effect.void).pipe(
  Command.withDescription('Manage the local database'),
  Command.withSubcommands([reset])
)

const cli = Command.make('sorato', {}, runDesktop).pipe(
  Command.withDescription('Run Sorato'),
  Command.withSubcommands([desktop, serve, db])
)

const program =
  process.argv.length <= 2 ? runDesktop() : Command.run(cli, { version })

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
