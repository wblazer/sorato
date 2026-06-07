import { dirname } from 'node:path'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { Effect, FileSystem, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

import { runMigrations } from './migrations.ts'

export interface SqlitePersistenceOptions {
  readonly filename: string
}

const ensureDatabaseDirectory = (filename: string) =>
  filename === ':memory:'
    ? Effect.void
    : Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.makeDirectory(dirname(filename), { recursive: true })
      })

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient

    yield* sql`PRAGMA foreign_keys = ON`
    yield* sql`PRAGMA journal_mode = WAL`
    yield* sql`PRAGMA synchronous = NORMAL`
    yield* sql`PRAGMA busy_timeout = 5000`

    yield* runMigrations()
  })
)

export const makeSqlitePersistenceLive = ({
  filename,
}: SqlitePersistenceOptions) =>
  Layer.unwrap(
    ensureDatabaseDirectory(filename).pipe(
      Effect.map(() =>
        Layer.provideMerge(setup, SqliteClient.layer({ filename }))
      )
    )
  )
