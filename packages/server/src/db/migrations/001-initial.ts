import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      path           TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      last_opened_at INTEGER,
      archived_at    INTEGER
    )
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projects_updated
    ON projects(updated_at)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projects_archived
    ON projects(archived_at)
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      title       TEXT,
      archived_at INTEGER,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id         TEXT PRIMARY KEY
                 CHECK (
                   length(id) = 64
                   AND id = lower(id)
                   AND id NOT GLOB '*[^0-9a-f]*'
                 ),
      content    TEXT NOT NULL CHECK (length(content) > 0),
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS runs (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      base_node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      kind             TEXT NOT NULL DEFAULT 'agent'
                       CHECK (kind IN ('agent', 'summary')),
      system_prompt_id TEXT REFERENCES system_prompts(id) ON DELETE RESTRICT,
      provider_id      TEXT,
      model_id         TEXT,
      billing_mode     TEXT,
      status           TEXT NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
      completed_at     TEXT,
      created_at       TEXT NOT NULL,
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
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'reasoning', 'tool')),
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS summaries (
      id                   TEXT PRIMARY KEY,
      session_id           TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content              TEXT NOT NULL,
      source_start_node_id TEXT NOT NULL REFERENCES nodes(id),
      source_end_node_id   TEXT NOT NULL REFERENCES nodes(id),
      run_id               TEXT REFERENCES runs(id) ON DELETE SET NULL,
      created_at           TEXT NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS nodes (
      id             TEXT PRIMARY KEY,
      session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      parent_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      kind           TEXT NOT NULL CHECK (kind IN ('message', 'summary')),
      message_id     TEXT REFERENCES messages(id) ON DELETE CASCADE,
      summary_id     TEXT REFERENCES summaries(id) ON DELETE CASCADE,
      source_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      run_id         TEXT REFERENCES runs(id) ON DELETE SET NULL,
      created_at     TEXT NOT NULL,
      check (
        (kind = 'message' and message_id is not null and summary_id is null)
        or
        (kind = 'summary' and summary_id is not null and message_id is null)
      )
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS model_calls (
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
    CREATE INDEX IF NOT EXISTS messages_session_created_idx
    ON messages (session_id, created_at)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS model_calls_session_run_idx
    ON model_calls (session_id, run_id)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS nodes_session_created_idx
    ON nodes (session_id, created_at)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS nodes_session_parent_idx
    ON nodes (session_id, parent_node_id)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS nodes_session_run_idx
    ON nodes (session_id, run_id)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS nodes_source_node_idx
    ON nodes (source_node_id)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS summaries_session_source_idx
    ON summaries (session_id, source_start_node_id, source_end_node_id)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS runs_session_created_idx
    ON runs (session_id, created_at)
  `

  yield* sql`
    CREATE INDEX IF NOT EXISTS runs_system_prompt_idx
    ON runs (system_prompt_id)
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

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS system_prompts_no_update
    BEFORE UPDATE ON system_prompts
    BEGIN
      SELECT RAISE(ABORT, 'system prompts are immutable');
    END
  `

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS runs_system_prompt_no_reassignment
    BEFORE UPDATE OF system_prompt_id ON runs
    WHEN OLD.system_prompt_id IS NOT NULL
      AND NEW.system_prompt_id IS NOT OLD.system_prompt_id
    BEGIN
      SELECT RAISE(ABORT, 'run system prompts are immutable');
    END
  `

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS runs_model_no_reassignment
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
})
