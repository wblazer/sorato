import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`ALTER TABLE model_calls RENAME TO model_calls_before_unbilled`
  yield* sql`
    CREATE TABLE model_calls (
      id                         TEXT PRIMARY KEY,
      session_id                 TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      run_id                     TEXT REFERENCES runs(id) ON DELETE SET NULL,
      assistant_node_id          TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE UNIQUE,
      provider_id                TEXT NOT NULL,
      model_id                   TEXT NOT NULL,
      billing_mode               TEXT NOT NULL CHECK (billing_mode IN ('api-key', 'subscription', 'unbilled')),
      input_tokens               INTEGER,
      output_tokens              INTEGER,
      reasoning_tokens           INTEGER,
      cache_read_tokens          INTEGER,
      cache_write_tokens         INTEGER,
      total_tokens               INTEGER,
      context_window_tokens      INTEGER,
      actual_cost_micros_usd     INTEGER,
      list_price_micros_usd      INTEGER,
      started_at                 TEXT,
      finished_at                TEXT NOT NULL
    )
  `
  yield* sql`
    INSERT INTO model_calls
    SELECT * FROM model_calls_before_unbilled
  `
  yield* sql`DROP TABLE model_calls_before_unbilled`
  yield* sql`
    CREATE INDEX model_calls_session_run_idx
    ON model_calls (session_id, run_id)
  `
})
