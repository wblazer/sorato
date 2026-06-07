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
    CREATE TABLE IF NOT EXISTS runs (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      base_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      created_at   TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
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
      billing_mode               TEXT NOT NULL CHECK (billing_mode IN ('api-key', 'subscription')),
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
})
