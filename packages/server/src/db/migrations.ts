import { Effect } from 'effect'
import * as Migrator from 'effect/unstable/sql/Migrator'

import Migration001 from './migrations/001-initial.ts'
import Migration002 from './migrations/002-run-status.ts'
import Migration003 from './migrations/003-durable-sync-events.ts'
import Migration004 from './migrations/004-ensure-durable-sync-events.ts'
import Migration005 from './migrations/005-system-prompts.ts'
import Migration006 from './migrations/006-reset-durable-sync-events.ts'
import Migration007 from './migrations/007-unbilled-model-calls.ts'
import Migration008 from './migrations/008-reset-run-attribution-events.ts'
import Migration009 from './migrations/009-run-model-attribution.ts'

export const migrationEntries = [
  [1, 'Initial', Migration001],
  [2, 'RunStatus', Migration002],
  [3, 'DurableSyncEvents', Migration003],
  [4, 'EnsureDurableSyncEvents', Migration004],
  [5, 'SystemPrompts', Migration005],
  [6, 'ResetDurableSyncEvents', Migration006],
  [7, 'UnbilledModelCalls', Migration007],
  [8, 'ResetRunAttributionEvents', Migration008],
  [9, 'RunModelAttribution', Migration009],
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
