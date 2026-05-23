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
  StorageError,
  type SessionId,
  type MessageId,
  type Session,
  type MessageNode,
  type SessionStorageApi,
} from './session.ts'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    directory   TEXT NOT NULL,
    title       TEXT,
    head_id     TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    parent_id   TEXT,
    encoded     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id)  REFERENCES messages(id)
  )`,

  'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_parent  ON messages(parent_id)',
]

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string
  directory: string
  title: string | null
  head_id: string | null
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  session_id: string
  parent_id: string | null
  encoded: string
  created_at: number
}

interface MessageInsertRow extends Record<string, unknown> {
  id: string
  session_id: string
  parent_id: string | null
  encoded: string
  created_at: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  directory: row.directory,
  title: row.title,
  headId: row.head_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const restoreToolDisplayFields = (
  decoded: Prompt.MessageEncoded,
  raw: unknown
): Prompt.MessageEncoded => {
  if (!isRecord(raw)) return decoded

  switch (decoded.role) {
    case 'assistant': {
      const rawContent = raw.content
      if (typeof decoded.content === 'string' || !Array.isArray(rawContent)) {
        return decoded
      }
      return {
        ...decoded,
        content: decoded.content.map((part, index) => {
          const rawPart = rawContent[index]
          if (part.type === 'tool-call' && isRecord(rawPart)) {
            return {
              ...part,
              ...(isRecord(rawPart.display)
                ? { display: rawPart.display }
                : {}),
            }
          }
          if (part.type !== 'tool-result' || !isRecord(rawPart)) return part
          return {
            ...part,
            ...(isRecord(rawPart.display) ? { display: rawPart.display } : {}),
          }
        }),
      }
    }
    case 'tool': {
      const rawContent = raw.content
      if (!Array.isArray(rawContent)) return decoded
      return {
        ...decoded,
        content: decoded.content.map((part, index) => {
          const rawPart = rawContent[index]
          if (part.type !== 'tool-result' || !isRecord(rawPart)) return part
          return {
            ...part,
            ...(isRecord(rawPart.display) ? { display: rawPart.display } : {}),
          }
        }),
      }
    }
    case 'system':
    case 'user':
      return decoded
  }
}

const decodeMessageNode = (encoded: string): Prompt.MessageEncoded => {
  const raw = JSON.parse(encoded)
  const decoded = Schema.decodeUnknownSync(Prompt.Message)(raw)
  return restoreToolDisplayFields(decoded, raw)
}

const toMessageNode = (row: MessageRow): MessageNode => ({
  id: row.id,
  sessionId: row.session_id,
  parentId: row.parent_id,
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
  parentId: string | null,
  messages: ReadonlyArray<Prompt.MessageEncoded>,
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
        directory: string,
        title?: string
      ) {
        const id = crypto.randomUUID()
        const now = Date.now()

        yield* sql`
          INSERT INTO sessions (id, directory, title, created_at, updated_at)
          VALUES (${id}, ${directory}, ${title ?? null}, ${now}, ${now})
        `.pipe(
          Effect.mapError(sqlFailure('create', 'Failed to create session'))
        )

        yield* Effect.logInfo('Session created', {
          sessionId: id,
          directory,
          hasTitle: title !== undefined,
        })

        return {
          id,
          directory,
          title: title ?? null,
          headId: null,
          createdAt: now,
          updatedAt: now,
        } satisfies Session
      })

      const get = Effect.fn('SessionStorage.get')(function* (id: SessionId) {
        const rows = yield* sql<SessionRow>`
          SELECT * FROM sessions WHERE id = ${id}
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
          SELECT * FROM sessions ORDER BY updated_at DESC
        `.pipe(Effect.mapError(sqlFailure('list', 'Failed to list sessions')))

        return rows.map(toSession)
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
                SELECT * FROM chain
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
          content: [...rows]
            .reverse()
            .map((row) =>
              Schema.decodeUnknownSync(Prompt.Message)(JSON.parse(row.encoded))
            ),
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
                SELECT * FROM chain
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
        messages: ReadonlyArray<Prompt.MessageEncoded>
      ) {
        if (messages.length === 0) return

        const session = yield* get(sessionId)
        const now = Date.now()
        const rows = messageInsertRows(sessionId, session.headId, messages, now)
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
          SELECT m.* FROM messages m
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
        setTitle,
        delete: del,
        conversation,
        messages,
        append,
        setHead,
        leaves,
      } satisfies SessionStorageApi
    })
  )
