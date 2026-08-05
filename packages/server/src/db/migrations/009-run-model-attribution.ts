import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`ALTER TABLE runs ADD COLUMN provider_id TEXT`
  yield* sql`ALTER TABLE runs ADD COLUMN model_id TEXT`
  yield* sql`
    ALTER TABLE runs ADD COLUMN billing_mode TEXT
    CHECK (
      (provider_id IS NULL AND model_id IS NULL AND billing_mode IS NULL)
      OR
      (
        provider_id IS NOT NULL
        AND model_id IS NOT NULL
        AND billing_mode IS NOT NULL
        AND billing_mode IN ('api-key', 'subscription', 'unbilled')
      )
    )
  `
  yield* sql`
    UPDATE runs
    SET
      provider_id = (
        SELECT provider_id FROM model_calls
        WHERE model_calls.run_id = runs.id
        ORDER BY finished_at ASC LIMIT 1
      ),
      model_id = (
        SELECT model_id FROM model_calls
        WHERE model_calls.run_id = runs.id
        ORDER BY finished_at ASC LIMIT 1
      ),
      billing_mode = (
        SELECT billing_mode FROM model_calls
        WHERE model_calls.run_id = runs.id
        ORDER BY finished_at ASC LIMIT 1
      )
    WHERE EXISTS (SELECT 1 FROM model_calls WHERE model_calls.run_id = runs.id)
  `
  yield* sql`
    CREATE TRIGGER runs_model_no_reassignment
    BEFORE UPDATE OF provider_id, model_id, billing_mode ON runs
    WHEN OLD.provider_id IS NOT NULL
      AND (
        NEW.provider_id IS NOT OLD.provider_id
        OR NEW.model_id IS NOT OLD.model_id
        OR NEW.billing_mode IS NOT OLD.billing_mode
      )
    BEGIN
      SELECT RAISE(ABORT, 'run model attribution is immutable');
    END
  `

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
