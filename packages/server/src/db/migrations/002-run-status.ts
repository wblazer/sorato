import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'interrupted', 'failed'))
  `

  yield* sql`
    ALTER TABLE runs ADD COLUMN completed_at TEXT
  `

  yield* sql`
    UPDATE runs
    SET status = 'completed', completed_at = created_at
    WHERE status = 'running'
  `
})
