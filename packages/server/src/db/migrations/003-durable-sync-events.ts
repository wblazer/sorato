import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS durable_sync_events (
      sequence   INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'node_batch_committed',
        'active_run_upserted',
        'run_end',
        'session_title_updated'
      )),
      session_id TEXT NOT NULL,
      run_id     TEXT,
      payload    TEXT NOT NULL CHECK (json_valid(payload)),
      created_at INTEGER NOT NULL,
      CHECK (
        (event_type IN ('node_batch_committed', 'active_run_upserted', 'run_end') AND run_id IS NOT NULL)
        OR
        (event_type = 'session_title_updated' AND run_id IS NULL)
      ),
      CHECK (
        (event_type = 'node_batch_committed' AND json_extract(payload, '$._tag') = 'NodeBatchCommitted')
        OR
        (event_type = 'active_run_upserted' AND json_extract(payload, '$._tag') = 'ActiveRunUpserted')
        OR
        (event_type = 'run_end' AND json_extract(payload, '$._tag') = 'RunEnd')
        OR
        (event_type = 'session_title_updated' AND json_extract(payload, '$._tag') = 'SessionTitleUpdated')
      )
    )
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS durable_sync_events_session_sequence_idx
    ON durable_sync_events (session_id, sequence)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS durable_sync_events_run_sequence_idx
    ON durable_sync_events (run_id, sequence)
  `

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS durable_sync_events_run_end_idx
    ON durable_sync_events (run_id)
    WHERE event_type = 'run_end'
  `

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS durable_sync_events_no_update
    BEFORE UPDATE ON durable_sync_events
    BEGIN
      SELECT RAISE(ABORT, 'durable sync events are append-only');
    END
  `

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS durable_sync_events_no_delete
    BEFORE DELETE ON durable_sync_events
    BEGIN
      SELECT RAISE(ABORT, 'durable sync events are append-only');
    END
  `
})
