import { Effect } from 'effect'
import * as Migrator from 'effect/unstable/sql/Migrator'

import Migration001 from './migrations/001-initial.ts'

export const migrationEntries = [[1, 'Initial', Migration001]] as const

const migrationLoader = Migrator.fromRecord(
  Object.fromEntries(
    migrationEntries.map(([id, name, migration]) => [
      `${id}_${name}`,
      migration,
    ])
  )
)

const run = Migrator.make({})

export const runMigrations = Effect.fn('runMigrations')(function* () {
  const executedMigrations = yield* run({
    loader: migrationLoader,
  })

  yield* Effect.logInfo('Database migrations ran successfully', {
    migrations: executedMigrations.map(([id, name]) => `${id}_${name}`),
  })

  return executedMigrations
})
