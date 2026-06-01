/**
 * SqliteSession — session storage backed by Effect SQL.
 *
 * Uses a single SQLite database with two tables:
 *
 * - `sessions` — session metadata + head pointer
 * - `messages` — tree-structured messages with parent pointers
 *
 * Conversation reconstruction uses a recursive CTE to walk from head
 * to root. Branch tips are found via NOT EXISTS. Both are standard
 * SQLite operations — no extensions required.
 *
 * The database is opened on layer construction and closed when the
 * layer's scope finalizes.
 */
import { FileSystem, Path } from 'effect'
import { Prompt } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import { Effect, Layer, Match, Option, Schema } from 'effect'
import {
  SessionStorage,
  StoredMessage,
  StorageError,
  type SessionId,
  type MessageId,
  type RunId,
  type Session,
  type Run,
  type MessageNode,
  type SessionStorageApi,
  type StoredMessageEncoded,
} from './session.ts'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    title       TEXT,
    head_id     TEXT,
    archived_at INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
  )`,

  `CREATE TABLE IF NOT EXISTS runs (
    id                         TEXT PRIMARY KEY,
    session_id                 TEXT NOT NULL,
    status                     TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
    provider_id                TEXT NOT NULL,
    model_id                   TEXT NOT NULL,
    billing_mode               TEXT NOT NULL CHECK (billing_mode IN ('api-key', 'subscription')),
    input_tokens               INTEGER,
    output_tokens              INTEGER,
    reasoning_tokens           INTEGER,
    cache_read_tokens          INTEGER,
    cache_write_tokens         INTEGER,
    total_tokens               INTEGER,
    actual_cost_micros_usd     INTEGER,
    list_price_micros_usd      INTEGER,
    created_at                 INTEGER NOT NULL,
    completed_at               INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    parent_id   TEXT,
    run_id      TEXT NOT NULL,
    encoded     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id)  REFERENCES messages(id),
    FOREIGN KEY (run_id)    REFERENCES runs(id) ON DELETE RESTRICT
  )`,

  'CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_parent  ON messages(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_run     ON messages(run_id)',
]

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string
  project_id: string
  title: string | null
  head_id: string | null
  archived_at: number | null
  last_user_message_at: number | null
  created_at: number
  updated_at: number
}

interface RunRow {
  id: string
  session_id: string
  status: 'running' | 'completed' | 'interrupted' | 'failed'
  provider_id: string
  model_id: string
  billing_mode: 'api-key' | 'subscription'
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  total_tokens: number | null
  actual_cost_micros_usd: number | null
  list_price_micros_usd: number | null
  created_at: number
  completed_at: number | null
}

interface MessageRow {
  id: string
  session_id: string
  parent_id: string | null
  run_id: string
  encoded: string
  created_at: number
  run_status: 'running' | 'completed' | 'interrupted' | 'failed'
  run_provider_id: string
  run_model_id: string
  run_billing_mode: 'api-key' | 'subscription'
  run_input_tokens: number | null
  run_output_tokens: number | null
  run_reasoning_tokens: number | null
  run_cache_read_tokens: number | null
  run_cache_write_tokens: number | null
  run_total_tokens: number | null
  run_actual_cost_micros_usd: number | null
  run_list_price_micros_usd: number | null
  run_created_at: number
  run_completed_at: number | null
}

interface MessageInsertRow extends Record<string, unknown> {
  id: string
  session_id: string
  parent_id: string | null
  run_id: string
  encoded: string
  created_at: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  headId: row.head_id,
  archivedAt: row.archived_at,
  lastUserMessageAt: row.last_user_message_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const decodeMessageNode = (encoded: string): StoredMessageEncoded => {
  return Schema.decodeUnknownSync(StoredMessage)(JSON.parse(encoded))
}

const decodePromptMessageOption = (
  encoded: string
): Option.Option<Prompt.MessageEncoded> => {
  try {
    return Option.some(
      Schema.decodeUnknownSync(Prompt.Message)(JSON.parse(encoded))
    )
  } catch {
    return Option.none()
  }
}

const toRun = (row: RunRow): Run => ({
  id: row.id,
  sessionId: row.session_id,
  status: row.status,
  providerId: row.provider_id,
  modelId: row.model_id,
  billingMode: row.billing_mode,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  reasoningTokens: row.reasoning_tokens,
  cacheReadTokens: row.cache_read_tokens,
  cacheWriteTokens: row.cache_write_tokens,
  totalTokens: row.total_tokens,
  actualCostMicrosUsd: row.actual_cost_micros_usd,
  listPriceMicrosUsd: row.list_price_micros_usd,
  createdAt: row.created_at,
  completedAt: row.completed_at,
})

const runFromMessageRow = (row: MessageRow): Run => ({
  id: row.run_id,
  sessionId: row.session_id,
  status: row.run_status,
  providerId: row.run_provider_id,
  modelId: row.run_model_id,
  billingMode: row.run_billing_mode,
  inputTokens: row.run_input_tokens,
  outputTokens: row.run_output_tokens,
  reasoningTokens: row.run_reasoning_tokens,
  cacheReadTokens: row.run_cache_read_tokens,
  cacheWriteTokens: row.run_cache_write_tokens,
  totalTokens: row.run_total_tokens,
  actualCostMicrosUsd: row.run_actual_cost_micros_usd,
  listPriceMicrosUsd: row.run_list_price_micros_usd,
  createdAt: row.run_created_at,
  completedAt: row.run_completed_at,
})

const toMessageNode = (row: MessageRow): MessageNode => ({
  id: row.id,
  sessionId: row.session_id,
  parentId: row.parent_id,
  runId: row.run_id,
  run: runFromMessageRow(row),
  encoded: decodeMessageNode(row.encoded),
  createdAt: row.created_at,
})

const ensureDatabaseDirectory = (databasePath: string) =>
  Match.value(databasePath).pipe(
    Match.when(':memory:', () => Effect.void),
    Match.orElse((_) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true })
      })
    )
  )

const sqlFailure = (operation: string, message: string) => (error: unknown) =>
  new StorageError({ operation, message, error })

const messageInsertRows = (
  sessionId: SessionId,
  runId: RunId,
  parentId: string | null,
  messages: ReadonlyArray<StoredMessageEncoded>,
  createdAt: number
): ReadonlyArray<MessageInsertRow> => {
  const rows: Array<MessageInsertRow> = []
  let nextParentId = parentId

  for (const msg of messages) {
    const id = crypto.randomUUID()
    rows.push({
      id,
      session_id: sessionId,
      parent_id: nextParentId,
      run_id: runId,
      encoded: JSON.stringify(msg),
      created_at: createdAt,
    })
    nextParentId = id
  }

  return rows
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a `SessionStorage` layer backed by SQLite at the given path.
 *
 * Pass `":memory:"` for an ephemeral in-memory database (useful for tests).
 * The database connection is scoped — it closes when the layer finalizes.
 */
export const SqliteSession = (options: { readonly path: string }) =>
  Layer.effect(SessionStorage)(
    Effect.gen(function* () {
      const sql = yield* SqlClient

      yield* ensureDatabaseDirectory(options.path).pipe(
        Effect.mapError(
          sqlFailure(
            'open',
            `Failed to create database directory: ${options.path}`
          )
        )
      )
      yield* Effect.forEach(SCHEMA, (statement) => sql.unsafe(statement)).pipe(
        Effect.mapError(
          sqlFailure('open', `Failed to initialize database: ${options.path}`)
        )
      )
      yield* Effect.logInfo('Session database initialized', {
        path: options.path,
      })

      // -- Service methods --------------------------------------------------

      const create = Effect.fn('SessionStorage.create')(function* (
        projectId: string,
        title?: string
      ) {
        const id = crypto.randomUUID()
        const now = Date.now()

        yield* sql`
          INSERT INTO sessions (id, project_id, title, created_at, updated_at)
          VALUES (${id}, ${projectId}, ${title ?? null}, ${now}, ${now})
        `.pipe(
          Effect.mapError(sqlFailure('create', 'Failed to create session'))
        )

        yield* Effect.logInfo('Session created', {
          sessionId: id,
          projectId,
          hasTitle: title !== undefined,
        })

        return {
          id,
          projectId,
          title: title ?? null,
          headId: null,
          archivedAt: null,
          lastUserMessageAt: null,
          createdAt: now,
          updatedAt: now,
        } satisfies Session
      })

      const get = Effect.fn('SessionStorage.get')(function* (id: SessionId) {
        const rows = yield* sql<SessionRow>`
          SELECT
            sessions.*,
            (
              SELECT MAX(messages.created_at)
              FROM messages
              WHERE messages.session_id = sessions.id
                AND json_extract(messages.encoded, '$.role') = 'user'
            ) AS last_user_message_at
          FROM sessions WHERE id = ${id}
        `.pipe(
          Effect.mapError(sqlFailure('get', `Failed to get session: ${id}`))
        )
        const row = rows[0]

        return yield* Effect.fromNullishOr(row).pipe(
          Effect.mapError(
            () =>
              new StorageError({
                operation: 'get',
                message: `Session not found: ${id}`,
              })
          ),
          Effect.map(toSession)
        )
      })

      const list = Effect.fn('SessionStorage.list')(function* () {
        const rows = yield* sql<SessionRow>`
          SELECT
            sessions.*,
            (
              SELECT MAX(messages.created_at)
              FROM messages
              WHERE messages.session_id = sessions.id
                AND json_extract(messages.encoded, '$.role') = 'user'
            ) AS last_user_message_at
          FROM sessions
          WHERE archived_at IS NULL
          ORDER BY COALESCE(last_user_message_at, updated_at) DESC
        `.pipe(Effect.mapError(sqlFailure('list', 'Failed to list sessions')))

        return rows.map(toSession)
      })

      const createRun: SessionStorageApi['createRun'] = Effect.fn(
        'SessionStorage.createRun'
      )(function* (input) {
        const now = input.createdAt ?? Date.now()
        yield* sql`
          INSERT INTO runs (
            id,
            session_id,
            status,
            provider_id,
            model_id,
            billing_mode,
            created_at
          ) VALUES (
            ${input.id},
            ${input.sessionId},
            'running',
            ${input.providerId},
            ${input.modelId},
            ${input.billingMode},
            ${now}
          )
        `.pipe(
          Effect.mapError(
            sqlFailure('createRun', `Failed to create run: ${input.id}`)
          )
        )
      })

      const updateRunUsage: SessionStorageApi['updateRunUsage'] = Effect.fn(
        'SessionStorage.updateRunUsage'
      )(function* (id, usage) {
        yield* sql`
          UPDATE runs SET
            input_tokens = ${usage.inputTokens},
            output_tokens = ${usage.outputTokens},
            reasoning_tokens = ${usage.reasoningTokens},
            cache_read_tokens = ${usage.cacheReadTokens},
            cache_write_tokens = ${usage.cacheWriteTokens},
            total_tokens = ${usage.totalTokens},
            actual_cost_micros_usd = ${usage.actualCostMicrosUsd},
            list_price_micros_usd = ${usage.listPriceMicrosUsd}
          WHERE id = ${id}
        `.pipe(
          Effect.mapError(
            sqlFailure('updateRunUsage', `Failed to update run usage: ${id}`)
          )
        )
      })

      const completeRun: SessionStorageApi['completeRun'] = Effect.fn(
        'SessionStorage.completeRun'
      )(function* (input) {
        const completedAt = input.completedAt ?? Date.now()
        const update = input.usage
          ? sql`
              UPDATE runs SET
                status = ${input.status},
                input_tokens = ${input.usage.inputTokens},
                output_tokens = ${input.usage.outputTokens},
                reasoning_tokens = ${input.usage.reasoningTokens},
                cache_read_tokens = ${input.usage.cacheReadTokens},
                cache_write_tokens = ${input.usage.cacheWriteTokens},
                total_tokens = ${input.usage.totalTokens},
                actual_cost_micros_usd = ${input.usage.actualCostMicrosUsd},
                list_price_micros_usd = ${input.usage.listPriceMicrosUsd},
                completed_at = ${completedAt}
              WHERE id = ${input.id}
            `
          : sql`
              UPDATE runs SET
                status = ${input.status},
                completed_at = ${completedAt}
              WHERE id = ${input.id}
            `
        yield* update.pipe(
          Effect.mapError(
            sqlFailure('completeRun', `Failed to complete run: ${input.id}`)
          )
        )
      })

      const getRun: SessionStorageApi['getRun'] = Effect.fn(
        'SessionStorage.getRun'
      )(function* (id) {
        const rows = yield* sql<RunRow>`
          SELECT * FROM runs WHERE id = ${id}
        `.pipe(
          Effect.mapError(sqlFailure('getRun', `Failed to get run: ${id}`))
        )
        return yield* Effect.fromNullishOr(rows[0]).pipe(
          Effect.mapError(
            () =>
              new StorageError({
                operation: 'getRun',
                message: `Run not found: ${id}`,
              })
          ),
          Effect.map(toRun)
        )
      })

      const setTitle: SessionStorageApi['setTitle'] = Effect.fn(
        'SessionStorage.setTitle'
      )(function* (id: SessionId, title: string | null) {
        yield* get(id)
        yield* sql`
          UPDATE sessions SET title = ${title}, updated_at = ${Date.now()} WHERE id = ${id}
        `.pipe(
          Effect.mapError(
            sqlFailure('setTitle', `Failed to set session title: ${id}`)
          )
        )
        yield* Effect.logInfo('Session title updated', {
          sessionId: id,
          hasTitle: title !== null,
        })
      })

      const del = Effect.fn('SessionStorage.delete')(function* (id: SessionId) {
        yield* sql`DELETE FROM sessions WHERE id = ${id}`.pipe(
          Effect.mapError(
            sqlFailure('delete', `Failed to delete session: ${id}`)
          )
        )
        yield* Effect.logInfo('Session deleted', { sessionId: id })
      })

      const archiveByProject: SessionStorageApi['archiveByProject'] = Effect.fn(
        'SessionStorage.archiveByProject'
      )(function* (projectId: string) {
        const now = Date.now()
        yield* sql`
          UPDATE sessions
          SET archived_at = ${now}, updated_at = ${now}
          WHERE project_id = ${projectId} AND archived_at IS NULL
        `.pipe(
          Effect.mapError(
            sqlFailure(
              'archiveByProject',
              `Failed to archive sessions for project: ${projectId}`
            )
          )
        )
        yield* Effect.logInfo('Project sessions archived', { projectId })
      })

      const conversation = Effect.fn('SessionStorage.conversation')(function* (
        sessionId: SessionId
      ) {
        const session = yield* get(sessionId)

        const rows = yield* Option.fromNullishOr(session.headId).pipe(
          Option.match({
            onNone: () => Effect.succeed([] as ReadonlyArray<MessageRow>),
            onSome: (headId) =>
              sql<MessageRow>`
                WITH RECURSIVE chain AS (
                  SELECT * FROM messages WHERE id = ${headId}
                  UNION ALL
                  SELECT m.* FROM messages m JOIN chain c ON m.id = c.parent_id
                )
                SELECT
                  chain.*,
                  runs.status AS run_status,
                  runs.provider_id AS run_provider_id,
                  runs.model_id AS run_model_id,
                  runs.billing_mode AS run_billing_mode,
                  runs.input_tokens AS run_input_tokens,
                  runs.output_tokens AS run_output_tokens,
                  runs.reasoning_tokens AS run_reasoning_tokens,
                  runs.cache_read_tokens AS run_cache_read_tokens,
                  runs.cache_write_tokens AS run_cache_write_tokens,
                  runs.total_tokens AS run_total_tokens,
                  runs.actual_cost_micros_usd AS run_actual_cost_micros_usd,
                  runs.list_price_micros_usd AS run_list_price_micros_usd,
                  runs.created_at AS run_created_at,
                  runs.completed_at AS run_completed_at
                FROM chain JOIN runs ON runs.id = chain.run_id
              `.pipe(
                Effect.mapError(
                  sqlFailure(
                    'conversation',
                    `Failed to load conversation: ${sessionId}`
                  )
                )
              ),
          })
        )
        return Schema.decodeUnknownSync(Prompt.Prompt)({
          content: [...rows].reverse().flatMap((row) => {
            const decoded = decodePromptMessageOption(row.encoded)
            return Option.isNone(decoded) ? [] : [decoded.value]
          }),
        })
      })

      const messages = Effect.fn('SessionStorage.messages')(function* (
        sessionId: SessionId
      ) {
        const session = yield* get(sessionId)

        const rows = yield* Option.fromNullishOr(session.headId).pipe(
          Option.match({
            onNone: () => Effect.succeed([] as ReadonlyArray<MessageRow>),
            onSome: (headId) =>
              sql<MessageRow>`
                WITH RECURSIVE chain AS (
                  SELECT * FROM messages WHERE id = ${headId}
                  UNION ALL
                  SELECT m.* FROM messages m JOIN chain c ON m.id = c.parent_id
                )
                SELECT
                  chain.*,
                  runs.status AS run_status,
                  runs.provider_id AS run_provider_id,
                  runs.model_id AS run_model_id,
                  runs.billing_mode AS run_billing_mode,
                  runs.input_tokens AS run_input_tokens,
                  runs.output_tokens AS run_output_tokens,
                  runs.reasoning_tokens AS run_reasoning_tokens,
                  runs.cache_read_tokens AS run_cache_read_tokens,
                  runs.cache_write_tokens AS run_cache_write_tokens,
                  runs.total_tokens AS run_total_tokens,
                  runs.actual_cost_micros_usd AS run_actual_cost_micros_usd,
                  runs.list_price_micros_usd AS run_list_price_micros_usd,
                  runs.created_at AS run_created_at,
                  runs.completed_at AS run_completed_at
                FROM chain JOIN runs ON runs.id = chain.run_id
              `.pipe(
                Effect.mapError(
                  sqlFailure(
                    'messages',
                    `Failed to load messages: ${sessionId}`
                  )
                )
              ),
          })
        )
        return [...rows].reverse().map(toMessageNode)
      })

      const append = Effect.fn('SessionStorage.append')(function* (
        sessionId: SessionId,
        runId: RunId,
        messages: ReadonlyArray<StoredMessageEncoded>
      ) {
        if (messages.length === 0) return

        const session = yield* get(sessionId)
        yield* getRun(runId)
        const now = Date.now()
        const rows = messageInsertRows(
          sessionId,
          runId,
          session.headId,
          messages,
          now
        )
        const headId = rows.at(-1)?.id ?? session.headId

        const insertMessages = sql`
          INSERT INTO messages ${sql.insert(rows)}
        `.pipe(
          Effect.andThen(
            sql`
              UPDATE sessions SET head_id = ${headId}, updated_at = ${now} WHERE id = ${sessionId}
            `
          )
        )

        yield* sql
          .withTransaction(insertMessages)
          .pipe(
            Effect.mapError(
              sqlFailure(
                'append',
                `Failed to append messages to session: ${sessionId}`
              )
            )
          )
        yield* Effect.logDebug('Session messages appended', {
          sessionId,
          runId,
          messageCount: messages.length,
          previousHeadId: session.headId,
          headId,
        })
      })

      const setHead = Effect.fn('SessionStorage.setHead')(function* (
        sessionId: SessionId,
        messageId: MessageId
      ) {
        // Verify the message belongs to this session
        const rows = yield* sql<{ id: string }>`
          SELECT id FROM messages WHERE id = ${messageId} AND session_id = ${sessionId}
        `.pipe(
          Effect.mapError(
            sqlFailure('setHead', `Failed to verify message: ${messageId}`)
          )
        )
        const exists = rows[0]

        const updateHead = sql`
          UPDATE sessions SET head_id = ${messageId}, updated_at = ${Date.now()} WHERE id = ${sessionId}
        `.pipe(
          Effect.mapError(
            sqlFailure('setHead', `Failed to update head: ${sessionId}`)
          )
        )

        yield* Effect.fromNullishOr(exists).pipe(
          Effect.mapError(
            () =>
              new StorageError({
                operation: 'setHead',
                message: `Message ${messageId} not found in session ${sessionId}`,
              })
          ),
          Effect.andThen(updateHead)
        )
        yield* Effect.logInfo('Session head updated', {
          sessionId,
          messageId,
        })
      })

      const leaves = Effect.fn('SessionStorage.leaves')(function* (
        sessionId: SessionId
      ) {
        // Verify session exists
        yield* get(sessionId)

        const rows = yield* sql<MessageRow>`
          SELECT
            m.*,
            runs.status AS run_status,
            runs.provider_id AS run_provider_id,
            runs.model_id AS run_model_id,
            runs.billing_mode AS run_billing_mode,
            runs.input_tokens AS run_input_tokens,
            runs.output_tokens AS run_output_tokens,
            runs.reasoning_tokens AS run_reasoning_tokens,
            runs.cache_read_tokens AS run_cache_read_tokens,
            runs.cache_write_tokens AS run_cache_write_tokens,
            runs.total_tokens AS run_total_tokens,
            runs.actual_cost_micros_usd AS run_actual_cost_micros_usd,
            runs.list_price_micros_usd AS run_list_price_micros_usd,
            runs.created_at AS run_created_at,
            runs.completed_at AS run_completed_at
          FROM messages m JOIN runs ON runs.id = m.run_id
          WHERE m.session_id = ${sessionId}
          AND NOT EXISTS (
            SELECT 1 FROM messages child WHERE child.parent_id = m.id
          )
        `.pipe(
          Effect.mapError(
            sqlFailure('leaves', `Failed to find leaves: ${sessionId}`)
          )
        )

        return rows.map(toMessageNode)
      })

      return {
        create,
        get,
        list,
        createRun,
        updateRunUsage,
        completeRun,
        getRun,
        setTitle,
        delete: del,
        archiveByProject,
        conversation,
        messages,
        append,
        setHead,
        leaves,
      } satisfies SessionStorageApi
    })
  )
