import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    CREATE TABLE system_prompts (
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
    ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'
    CHECK (kind IN ('agent', 'summary'))
  `

  yield* sql`
    UPDATE runs
    SET kind = 'summary'
    WHERE
      EXISTS (
        SELECT 1 FROM summaries WHERE summaries.run_id = runs.id
      )
      OR EXISTS (
        SELECT 1
        FROM durable_sync_events
        WHERE durable_sync_events.run_id = runs.id
          AND event_type = 'active_run_upserted'
          AND json_extract(payload, '$.kind') = 'summary'
      )
  `

  yield* sql`
    ALTER TABLE runs ADD COLUMN system_prompt_id TEXT
    REFERENCES system_prompts(id) ON DELETE RESTRICT
  `

  yield* sql`
    CREATE INDEX runs_system_prompt_idx ON runs(system_prompt_id)
  `

  const historicalRuns = yield* sql<{
    readonly id: string
    readonly session_id: string
    readonly base_node_id: string | null
    readonly created_at: string
  }>`
    SELECT id, session_id, base_node_id, created_at
    FROM runs
    WHERE kind = 'agent'
  `

  for (const run of historicalRuns) {
    const parts = yield* sql<{
      readonly source: 'system-prompt' | 'agents-md'
      readonly content: string
      readonly created_at: string
    }>`
      WITH RECURSIVE branch AS (
        SELECT id, parent_node_id
        FROM nodes
        WHERE id = ${run.base_node_id} AND session_id = ${run.session_id}
        UNION ALL
        SELECT n.id, n.parent_node_id
        FROM nodes n
        JOIN branch b ON n.id = b.parent_node_id
      ), candidates AS (
        SELECT
          json_extract(m.content, '$.source') AS source,
          json_extract(m.content, '$.content') AS content,
          n.created_at,
          n.rowid
        FROM nodes n
        JOIN messages m ON m.id = n.message_id
        WHERE n.session_id = ${run.session_id}
          AND (n.id IN (SELECT id FROM branch) OR n.run_id = ${run.id})
          AND json_extract(m.content, '$.source') IN ('system-prompt', 'agents-md')
      )
      SELECT source, content, created_at
      FROM candidates
      ORDER BY created_at ASC, rowid ASC
    `
    const latest = new Map(parts.map((part) => [part.source, part.content]))
    const content = [latest.get('system-prompt'), latest.get('agents-md')]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join('\n\n')
    if (content.length === 0) continue

    const id = createHash('sha256').update(content, 'utf8').digest('hex')
    yield* sql`
      INSERT INTO system_prompts (id, content, created_at)
      VALUES (${id}, ${content}, ${run.created_at})
      ON CONFLICT(id) DO NOTHING
    `
    yield* sql`
      UPDATE runs SET system_prompt_id = ${id} WHERE id = ${run.id}
    `
  }

  const bootstrapNodes = yield* sql<{
    readonly id: string
    readonly message_id: string
    readonly parent_node_id: string | null
  }>`
    SELECT n.id, n.message_id, n.parent_node_id
    FROM nodes n
    JOIN messages m ON m.id = n.message_id
    WHERE json_extract(m.content, '$.source') IN ('system-prompt', 'agents-md')
    ORDER BY n.created_at DESC, n.rowid DESC
  `

  for (const node of bootstrapNodes) {
    yield* sql`
      UPDATE nodes
      SET parent_node_id = ${node.parent_node_id}
      WHERE parent_node_id = ${node.id}
    `
    yield* sql`
      UPDATE runs
      SET base_node_id = ${node.parent_node_id}
      WHERE base_node_id = ${node.id}
    `
    yield* sql`DELETE FROM nodes WHERE id = ${node.id}`
    yield* sql`DELETE FROM messages WHERE id = ${node.message_id}`
  }

  // Existing node batches use the old run representation and may also contain
  // removed bootstrap nodes. Clients rebuild from the authoritative snapshot.
  yield* sql`DROP TRIGGER IF EXISTS durable_sync_events_no_delete`
  yield* sql`DELETE FROM durable_sync_events`
  yield* sql`
    CREATE TRIGGER durable_sync_events_no_delete
    BEFORE DELETE ON durable_sync_events
    BEGIN
      SELECT RAISE(ABORT, 'durable sync events are append-only');
    END
  `

  yield* sql`
    CREATE TRIGGER system_prompts_no_update
    BEFORE UPDATE ON system_prompts
    BEGIN
      SELECT RAISE(ABORT, 'system prompts are immutable');
    END
  `

  yield* sql`
    CREATE TRIGGER runs_system_prompt_no_reassignment
    BEFORE UPDATE OF system_prompt_id ON runs
    WHEN OLD.system_prompt_id IS NOT NULL
      AND NEW.system_prompt_id IS NOT OLD.system_prompt_id
    BEGIN
      SELECT RAISE(ABORT, 'run system prompts are immutable');
    END
  `
})
