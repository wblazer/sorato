/**
 * SqliteSession — session storage backed by bun:sqlite.
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
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Prompt } from 'effect/unstable/ai'
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

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    directory   TEXT NOT NULL,
    model       TEXT NOT NULL,
    title       TEXT,
    head_id     TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    parent_id   TEXT,
    encoded     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id)  REFERENCES messages(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_parent  ON messages(parent_id);
`

// ---------------------------------------------------------------------------
// Row types (what bun:sqlite returns)
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string
  directory: string
  model: string
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  directory: row.directory,
  model: row.model,
  title: row.title,
  headId: row.head_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const LEGACY_MODEL = 'anthropic/claude-sonnet-4-20250514'

const toMessageNode = (row: MessageRow): MessageNode => ({
  id: row.id,
  sessionId: row.session_id,
  parentId: row.parent_id,
  encoded: JSON.parse(row.encoded) as Prompt.MessageEncoded,
  createdAt: row.created_at,
})

// ---------------------------------------------------------------------------
// Prepared statement queries
// ---------------------------------------------------------------------------

const prepareStatements = (db: Database) => {
  const insertSession = db.prepare<
    void,
    [string, string, string, string | null, number, number]
  >(
    'INSERT INTO sessions (id, directory, model, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )

  const getSession = db.prepare<SessionRow, [string]>(
    'SELECT * FROM sessions WHERE id = ?'
  )

  const listSessions = db.prepare<SessionRow, []>(
    'SELECT * FROM sessions ORDER BY updated_at DESC'
  )

  const deleteSession = db.prepare<void, [string]>(
    'DELETE FROM sessions WHERE id = ?'
  )

  const updateHead = db.prepare<void, [string | null, number, string]>(
    'UPDATE sessions SET head_id = ?, updated_at = ? WHERE id = ?'
  )

  const updateModel = db.prepare<void, [string, number, string]>(
    'UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?'
  )

  const insertMessage = db.prepare<
    void,
    [string, string, string | null, string, number]
  >(
    'INSERT INTO messages (id, session_id, parent_id, encoded, created_at) VALUES (?, ?, ?, ?, ?)'
  )

  const getMessage = db.prepare<MessageRow, [string]>(
    'SELECT * FROM messages WHERE id = ?'
  )

  /**
   * Recursive CTE: walk from a given message up to the root.
   * Returns messages in leaf-to-root order.
   */
  const walkToRoot = db.prepare<MessageRow, [string]>(`
    WITH RECURSIVE chain AS (
      SELECT * FROM messages WHERE id = ?
      UNION ALL
      SELECT m.* FROM messages m JOIN chain c ON m.id = c.parent_id
    )
    SELECT * FROM chain
  `)

  /**
   * Find all leaf messages — messages with no children.
   */
  const findLeaves = db.prepare<MessageRow, [string]>(`
    SELECT m.* FROM messages m
    WHERE m.session_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM messages child WHERE child.parent_id = m.id
    )
  `)

  /**
   * Verify a message belongs to a session.
   */
  const messageInSession = db.prepare<{ id: string }, [string, string]>(
    'SELECT id FROM messages WHERE id = ? AND session_id = ?'
  )

  return {
    insertSession,
    getSession,
    listSessions,
    deleteSession,
    updateHead,
    updateModel,
    insertMessage,
    getMessage,
    walkToRoot,
    findLeaves,
    messageInSession,
  }
}

const migrate = (db: Database) => {
  const cols = db
    .prepare<{ name: string }, []>('PRAGMA table_info(sessions)')
    .all()

  cols.some((col) => col.name === 'model') ||
    Boolean(db.run('ALTER TABLE sessions ADD COLUMN model TEXT'))

  db.prepare('UPDATE sessions SET model = ? WHERE model IS NULL').run(
    LEGACY_MODEL
  )
}

const ensureDatabaseDirectory = (path: string) =>
  Match.value(path).pipe(
    Match.when(':memory:', () => undefined),
    Match.orElse((databasePath) =>
      mkdirSync(dirname(databasePath), { recursive: true })
    )
  )

const openDatabase = (path: string) => {
  ensureDatabaseDirectory(path)

  const database = new Database(path)
  database.run('PRAGMA journal_mode = WAL')
  database.run('PRAGMA foreign_keys = ON')
  database.run(SCHEMA)
  migrate(database)

  return database
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
      const db = yield* Effect.try({
        try: () => openDatabase(options.path),
        catch: (error) =>
          new StorageError({
            operation: 'open',
            message: `Failed to open database: ${options.path}`,
            error,
          }),
      })

      yield* Effect.addFinalizer(() =>
        Effect.try({
          try: () => db.close(),
          catch: (error) =>
            new StorageError({
              operation: 'close',
              message: `Failed to close database: ${options.path}`,
              error,
            }),
        }).pipe(Effect.catch(() => Effect.void))
      )

      const stmts = prepareStatements(db)

      function decodeConversation(
        rows: ReadonlyArray<MessageRow>,
        sessionId: SessionId
      ) {
        // Rows come back leaf-to-root; reverse for chronological order
        const encoded = [...rows]
          .reverse()
          .map(
            (row: MessageRow) =>
              JSON.parse(row.encoded) as Prompt.MessageEncoded
          )

        return Effect.try({
          try: () =>
            Schema.decodeUnknownSync(Prompt.Prompt)({ content: encoded }),
          catch: (error) =>
            new StorageError({
              operation: 'conversation',
              message: `Failed to decode conversation: ${sessionId}`,
              error,
            }),
        })
      }

      // -- Service methods --------------------------------------------------

      const create = Effect.fn('SessionStorage.create')(function* (
        directory: string,
        model: string,
        title?: string
      ) {
        const id = crypto.randomUUID()
        const now = Date.now()

        yield* Effect.try({
          try: () =>
            stmts.insertSession.run(
              id,
              directory,
              model,
              title ?? null,
              now,
              now
            ),
          catch: (error) =>
            new StorageError({
              operation: 'create',
              message: 'Failed to create session',
              error,
            }),
        })

        return {
          id,
          directory,
          model,
          title: title ?? null,
          headId: null,
          createdAt: now,
          updatedAt: now,
        } satisfies Session
      })

      const get = Effect.fn('SessionStorage.get')(function* (id: SessionId) {
        const row = yield* Effect.try({
          try: () => stmts.getSession.get(id),
          catch: (error) =>
            new StorageError({
              operation: 'get',
              message: `Failed to get session: ${id}`,
              error,
            }),
        })

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
        const rows = yield* Effect.try({
          try: () => stmts.listSessions.all(),
          catch: (error) =>
            new StorageError({
              operation: 'list',
              message: 'Failed to list sessions',
              error,
            }),
        })

        return rows.map(toSession)
      })

      const del = Effect.fn('SessionStorage.delete')(function* (id: SessionId) {
        yield* Effect.try({
          try: () => stmts.deleteSession.run(id),
          catch: (error) =>
            new StorageError({
              operation: 'delete',
              message: `Failed to delete session: ${id}`,
              error,
            }),
        })
      })

      const conversation = Effect.fn('SessionStorage.conversation')(function* (
        sessionId: SessionId
      ) {
        const session = yield* get(sessionId)

        return yield* Option.fromNullishOr(session.headId).pipe(
          Option.match({
            onNone: () => Effect.succeed(Prompt.empty),
            onSome: (headId) => {
              const rows = Effect.try({
                try: () => stmts.walkToRoot.all(headId),
                catch: (error) =>
                  new StorageError({
                    operation: 'conversation',
                    message: `Failed to walk conversation: ${sessionId}`,
                    error,
                  }),
              })

              const prompt = Effect.flatMap(rows, (walkedRows) =>
                decodeConversation(walkedRows, sessionId)
              )

              return prompt
            },
          })
        )
      })

      const messages = Effect.fn('SessionStorage.messages')(function* (
        sessionId: SessionId
      ) {
        const session = yield* get(sessionId)

        return yield* Option.fromNullishOr(session.headId).pipe(
          Option.match({
            onNone: () => Effect.succeed([] as ReadonlyArray<MessageNode>),
            onSome: (headId) => {
              const rows = Effect.try({
                try: () => stmts.walkToRoot.all(headId),
                catch: (error) =>
                  new StorageError({
                    operation: 'messages',
                    message: `Failed to walk messages: ${sessionId}`,
                    error,
                  }),
              })

              const messages = Effect.map(
                rows,
                // Rows come back leaf-to-root; reverse for chronological order
                (walkedRows) => walkedRows.reverse().map(toMessageNode)
              )

              return messages
            },
          })
        )
      })

      const append = Effect.fn('SessionStorage.append')(function* (
        sessionId: SessionId,
        messages: ReadonlyArray<Prompt.MessageEncoded>
      ) {
        if (messages.length === 0) return

        const session = yield* get(sessionId)
        const now = Date.now()
        let parentId: string | null = session.headId
        let lastId: string | null = null

        yield* Effect.try({
          try: () => {
            const tx = db.transaction(() => {
              for (const msg of messages) {
                const id = crypto.randomUUID()
                stmts.insertMessage.run(
                  id,
                  sessionId,
                  parentId,
                  JSON.stringify(msg),
                  now
                )
                parentId = id
                lastId = id
              }

              lastId !== null && stmts.updateHead.run(lastId, now, sessionId)
            })
            tx()
          },
          catch: (error) =>
            new StorageError({
              operation: 'append',
              message: `Failed to append messages to session: ${sessionId}`,
              error,
            }),
        })
      })

      const setHead = Effect.fn('SessionStorage.setHead')(function* (
        sessionId: SessionId,
        messageId: MessageId
      ) {
        // Verify the message belongs to this session
        const exists = yield* Effect.try({
          try: () => stmts.messageInSession.get(messageId, sessionId),
          catch: (error) =>
            new StorageError({
              operation: 'setHead',
              message: `Failed to verify message: ${messageId}`,
              error,
            }),
        })

        yield* Effect.fromNullishOr(exists).pipe(
          Effect.mapError(
            () =>
              new StorageError({
                operation: 'setHead',
                message: `Message ${messageId} not found in session ${sessionId}`,
              })
          ),
          Effect.flatMap(() =>
            Effect.try({
              try: () => stmts.updateHead.run(messageId, Date.now(), sessionId),
              catch: (error) =>
                new StorageError({
                  operation: 'setHead',
                  message: `Failed to update head: ${sessionId}`,
                  error,
                }),
            })
          )
        )
      })

      const setModel = Effect.fn('SessionStorage.setModel')(function* (
        sessionId: SessionId,
        model: string
      ) {
        yield* get(sessionId)

        yield* Effect.try({
          try: () => stmts.updateModel.run(model, Date.now(), sessionId),
          catch: (error) =>
            new StorageError({
              operation: 'setModel',
              message: `Failed to update model: ${sessionId}`,
              error,
            }),
        })
      })

      const leaves = Effect.fn('SessionStorage.leaves')(function* (
        sessionId: SessionId
      ) {
        // Verify session exists
        yield* get(sessionId)

        const rows = yield* Effect.try({
          try: () => stmts.findLeaves.all(sessionId),
          catch: (error) =>
            new StorageError({
              operation: 'leaves',
              message: `Failed to find leaves: ${sessionId}`,
              error,
            }),
        })

        return rows.map(toMessageNode)
      })

      return {
        create,
        get,
        list,
        delete: del,
        conversation,
        messages,
        append,
        setHead,
        setModel,
        leaves,
      } satisfies SessionStorageApi
    })
  )
