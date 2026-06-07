import { join } from 'node:path'
import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Console, Effect, FileSystem } from 'effect'
import { dataDir } from '../src/data-dir.ts'

const sessionDbPath = join(dataDir, 'sessions.db')
const providerAuthDbPath = join(dataDir, 'server.db')

const removeFile = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(path, { force: true })
    yield* Console.log(`removed ${path}`)
  })

const resetSessionDb = Effect.all(
  [sessionDbPath, `${sessionDbPath}-wal`, `${sessionDbPath}-shm`].map(
    removeFile
  ),
  { concurrency: 'unbounded' }
)

const resetProviderAuthDb = Effect.all(
  [
    providerAuthDbPath,
    `${providerAuthDbPath}-wal`,
    `${providerAuthDbPath}-shm`,
  ].map(removeFile),
  { concurrency: 'unbounded' }
)

const shouldResetAll = process.argv.includes('--all')

const program = Effect.gen(function* () {
  yield* Console.log(`Resetting Sorato local dev database in ${dataDir}`)
  yield* resetSessionDb

  if (shouldResetAll) {
    yield* resetProviderAuthDb
  } else {
    yield* Console.log(
      'kept provider auth database (pass --all to remove server.db too)'
    )
  }

  yield* Console.log('done')
})

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)))
