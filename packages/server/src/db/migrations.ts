import { Effect } from 'effect'
import * as Migrator from 'effect/unstable/sql/Migrator'

import Migration001 from './migrations/001-initial.ts'
import Migration002 from './migrations/002-run-status.ts'

export const migrationEntries = [
  [1, 'Initial', Migration001],
  [2, 'RunStatus', Migration002],
] as const

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration])
    )
  )

const run = Migrator.make({})

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined
}

export const runMigrations = Effect.fn('runMigrations')(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const executedMigrations = yield* run({
    loader: makeMigrationLoader(toMigrationInclusive),
  })

  yield* Effect.logInfo('Database migrations ran successfully', {
    migrations: executedMigrations.map(([id, name]) => `${id}_${name}`),
  })

  return executedMigrations
})
