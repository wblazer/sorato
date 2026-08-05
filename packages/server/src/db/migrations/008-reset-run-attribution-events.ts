import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  // Node snapshots are authoritative; durable events are only a replay cache.
  yield* sql`DROP TRIGGER IF EXISTS durable_sync_events_no_delete`
  yield* sql`DELETE FROM durable_sync_events`
  yield* sql`
    CREATE TRIGGER durable_sync_events_no_delete
    BEFORE DELETE ON durable_sync_events
    BEGIN
      SELECT RAISE(ABORT, 'durable sync events are append-only');
    END
  `
})
