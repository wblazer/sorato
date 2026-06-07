/** SqliteSession — node/content session storage backed by Effect SQL. */
import { Effect, Layer, Option, Schema } from 'effect'
import { Prompt } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'
import {
  MessageNodeRow,
  RunTableRow,
  SessionWithLastUserMessageRow,
} from '../db/schema.ts'
import {
  SessionStorage,
  StorageError,
  StoredMessage,
  type MessageNode,
  type ModelCall,
  type Run,
  type RunId,
  type Session,
  type SessionId,
  type SessionStorageApi,
  type StoredMessageEncoded,
} from './session.ts'

const SessionIdInput = Schema.Struct({ id: Schema.String })
const RunIdInput = Schema.Struct({ id: Schema.String })
const NodeIdInput = Schema.Struct({ id: Schema.String })
const NodeBelongsToSessionInput = Schema.Struct({
  node_id: Schema.String,
  session_id: Schema.String,
})

const CreateSessionRowInput = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  title: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
})

const CreateRunRowInput = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  base_node_id: Schema.NullOr(Schema.String),
  created_at: Schema.String,
})

const SetSessionTitleInput = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  updated_at: Schema.String,
})

const ArchiveProjectSessionsInput = Schema.Struct({
  project_id: Schema.String,
  archived_at: Schema.Number,
  updated_at: Schema.String,
})

const CreateModelCallRowInput = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  run_id: Schema.NullOr(Schema.String),
  assistant_node_id: Schema.String,
  provider_id: Schema.String,
  model_id: Schema.String,
  billing_mode: Schema.Literals(['api-key', 'subscription']),
  input_tokens: Schema.NullOr(Schema.Number),
  output_tokens: Schema.NullOr(Schema.Number),
  reasoning_tokens: Schema.NullOr(Schema.Number),
  cache_read_tokens: Schema.NullOr(Schema.Number),
  cache_write_tokens: Schema.NullOr(Schema.Number),
  total_tokens: Schema.NullOr(Schema.Number),
  context_window_tokens: Schema.NullOr(Schema.Number),
  actual_cost_micros_usd: Schema.NullOr(Schema.Number),
  list_price_micros_usd: Schema.NullOr(Schema.Number),
  started_at: Schema.NullOr(Schema.String),
  finished_at: Schema.String,
})

const NodeIdentityRow = Schema.Struct({ id: Schema.String })

type SessionRow = SessionWithLastUserMessageRow
type NodeRow = MessageNodeRow

type MessageInsertRow = {
  readonly id: string
  readonly session_id: string
  readonly role: string
  readonly content: string
  readonly created_at: string
}

type NodeInsertRow = {
  readonly id: string
  readonly session_id: string
  readonly parent_node_id: string | null
  readonly kind: 'message'
  readonly message_id: string
  readonly summary_id: null
  readonly source_node_id: null
  readonly run_id: string
  readonly created_at: string
}

const nowIso = () => new Date().toISOString()
const toMillis = (value: string | null): number | null =>
  value === null ? null : Date.parse(value)

const emptyUsage = {
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  contextWindowTokens: null,
  actualCostMicrosUsd: null,
  listPriceMicrosUsd: null,
} as const

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  archivedAt: row.archived_at,
  lastUserMessageAt: toMillis(row.last_user_message_at),
  createdAt: Date.parse(row.created_at),
  updatedAt: Date.parse(row.updated_at),
})

const toRun = (row: RunTableRow): Run => ({
  id: row.id,
  sessionId: row.session_id,
  status: 'completed',
  providerId: 'unknown',
  modelId: 'unknown',
  billingMode: 'api-key',
  baseNodeId: row.base_node_id,
  ...emptyUsage,
  createdAt: Date.parse(row.created_at),
  completedAt: null,
})

const runFromNodeRow = (row: NodeRow): Run | null =>
  row.run_id === null || row.run_created_at === null
    ? null
    : {
        id: row.run_id,
        sessionId: row.session_id,
        status: 'completed',
        providerId: row.model_call_provider_id ?? 'unknown',
        modelId: row.model_call_model_id ?? 'unknown',
        billingMode: row.model_call_billing_mode ?? 'api-key',
        baseNodeId: row.run_base_node_id,
        ...emptyUsage,
        createdAt: Date.parse(row.run_created_at),
        completedAt: null,
      }

const modelCallFromNodeRow = (row: NodeRow): ModelCall | null =>
  row.model_call_id === null || row.model_call_finished_at === null
    ? null
    : {
        id: row.model_call_id,
        sessionId: row.session_id,
        runId: row.run_id,
        assistantNodeId: row.id,
        providerId: row.model_call_provider_id ?? 'unknown',
        modelId: row.model_call_model_id ?? 'unknown',
        billingMode: row.model_call_billing_mode ?? 'api-key',
        inputTokens: row.model_call_input_tokens,
        outputTokens: row.model_call_output_tokens,
        reasoningTokens: row.model_call_reasoning_tokens,
        cacheReadTokens: row.model_call_cache_read_tokens,
        cacheWriteTokens: row.model_call_cache_write_tokens,
        totalTokens: row.model_call_total_tokens,
        contextWindowTokens: row.model_call_context_window_tokens,
        actualCostMicrosUsd: row.model_call_actual_cost_micros_usd,
        listPriceMicrosUsd: row.model_call_list_price_micros_usd,
        startedAt: toMillis(row.model_call_started_at),
        finishedAt: Date.parse(row.model_call_finished_at),
      }

const decodeStoredMessage = (content: string): StoredMessageEncoded =>
  Schema.decodeUnknownSync(StoredMessage)(JSON.parse(content))

const decodePromptMessageOption = (
  content: string
): Option.Option<Prompt.MessageEncoded> => {
  try {
    return Option.some(
      Schema.decodeUnknownSync(Prompt.Message)(JSON.parse(content))
    )
  } catch {
    return Option.none()
  }
}

const toMessageNode = (row: NodeRow): MessageNode => ({
  id: row.id,
  sessionId: row.session_id,
  parentId: row.parent_node_id,
  kind: row.kind,
  messageId: row.message_id,
  summaryId: row.summary_id,
  sourceNodeId: row.source_node_id,
  runId: row.run_id,
  run: runFromNodeRow(row),
  modelCall: modelCallFromNodeRow(row),
  encoded: decodeStoredMessage(
    row.message_content ?? '{"role":"system","content":""}'
  ),
  createdAt: Date.parse(row.created_at),
})

const sqlFailure = (operation: string, message: string) => (error: unknown) =>
  new StorageError({ operation, message, error })
const notFound = (operation: string, message: string) =>
  new StorageError({ operation, message })

const messageRole = (message: StoredMessageEncoded): string =>
  message.role === 'tool' ? 'tool' : message.role

const insertRows = (
  sessionId: SessionId,
  runId: RunId,
  parentNodeId: string | null,
  messages: ReadonlyArray<StoredMessageEncoded>,
  createdAt: string
): {
  readonly messages: ReadonlyArray<MessageInsertRow>
  readonly nodes: ReadonlyArray<NodeInsertRow>
} => {
  const messageRows: Array<MessageInsertRow> = []
  const nodeRows: Array<NodeInsertRow> = []
  let nextParentId = parentNodeId

  for (const msg of messages) {
    const messageId = crypto.randomUUID()
    const nodeId = crypto.randomUUID()
    messageRows.push({
      id: messageId,
      session_id: sessionId,
      role: messageRole(msg),
      content: JSON.stringify(msg),
      created_at: createdAt,
    })
    nodeRows.push({
      id: nodeId,
      session_id: sessionId,
      parent_node_id: nextParentId,
      kind: 'message',
      message_id: messageId,
      summary_id: null,
      source_node_id: null,
      run_id: runId,
      created_at: createdAt,
    })
    nextParentId = nodeId
  }

  return { messages: messageRows, nodes: nodeRows }
}

const sessionSelection = (sql: SqlClient) => sql`
  SELECT
    sessions.id,
    sessions.project_id,
    sessions.title,
    sessions.archived_at,
    sessions.created_at,
    sessions.updated_at,
    (
      SELECT MAX(messages.created_at)
      FROM nodes JOIN messages ON messages.id = nodes.message_id
      WHERE nodes.session_id = sessions.id AND messages.role = 'user'
    ) AS last_user_message_at
  FROM sessions
`

const nodeSelection = (sql: SqlClient) => sql`
  SELECT
    n.id,
    n.session_id,
    n.parent_node_id,
    n.kind,
    n.message_id,
    n.summary_id,
    n.source_node_id,
    n.run_id,
    n.created_at,
    m.role AS message_role,
    m.content AS message_content,
    m.created_at AS message_created_at,
    r.created_at AS run_created_at,
    r.base_node_id AS run_base_node_id,
    mc.id AS model_call_id,
    mc.provider_id AS model_call_provider_id,
    mc.model_id AS model_call_model_id,
    mc.billing_mode AS model_call_billing_mode,
    mc.input_tokens AS model_call_input_tokens,
    mc.output_tokens AS model_call_output_tokens,
    mc.reasoning_tokens AS model_call_reasoning_tokens,
    mc.cache_read_tokens AS model_call_cache_read_tokens,
    mc.cache_write_tokens AS model_call_cache_write_tokens,
    mc.total_tokens AS model_call_total_tokens,
    mc.context_window_tokens AS model_call_context_window_tokens,
    mc.actual_cost_micros_usd AS model_call_actual_cost_micros_usd,
    mc.list_price_micros_usd AS model_call_list_price_micros_usd,
    mc.started_at AS model_call_started_at,
    mc.finished_at AS model_call_finished_at
  FROM nodes n
  LEFT JOIN messages m ON m.id = n.message_id
  LEFT JOIN runs r ON r.id = n.run_id
  LEFT JOIN model_calls mc ON mc.assistant_node_id = n.id
`

const chainNodeSelection = (sql: SqlClient) => sql`
  SELECT
    n.id,
    n.session_id,
    n.parent_node_id,
    n.kind,
    n.message_id,
    n.summary_id,
    n.source_node_id,
    n.run_id,
    n.created_at,
    m.role AS message_role,
    m.content AS message_content,
    m.created_at AS message_created_at,
    r.created_at AS run_created_at,
    r.base_node_id AS run_base_node_id,
    mc.id AS model_call_id,
    mc.provider_id AS model_call_provider_id,
    mc.model_id AS model_call_model_id,
    mc.billing_mode AS model_call_billing_mode,
    mc.input_tokens AS model_call_input_tokens,
    mc.output_tokens AS model_call_output_tokens,
    mc.reasoning_tokens AS model_call_reasoning_tokens,
    mc.cache_read_tokens AS model_call_cache_read_tokens,
    mc.cache_write_tokens AS model_call_cache_write_tokens,
    mc.total_tokens AS model_call_total_tokens,
    mc.context_window_tokens AS model_call_context_window_tokens,
    mc.actual_cost_micros_usd AS model_call_actual_cost_micros_usd,
    mc.list_price_micros_usd AS model_call_list_price_micros_usd,
    mc.started_at AS model_call_started_at,
    mc.finished_at AS model_call_finished_at
  FROM chain n
  LEFT JOIN messages m ON m.id = n.message_id
  LEFT JOIN runs r ON r.id = n.run_id
  LEFT JOIN model_calls mc ON mc.assistant_node_id = n.id
`

export const SqliteSession = (options: { readonly path: string }) =>
  Layer.effect(SessionStorage)(
    Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* Effect.logInfo('Session storage initialized', {
        path: options.path,
      })

      const insertSessionRow = SqlSchema.void({
        Request: CreateSessionRowInput,
        execute: (row) => sql`
          INSERT INTO sessions (id, project_id, title, created_at, updated_at)
          VALUES (${row.id}, ${row.project_id}, ${row.title}, ${row.created_at}, ${row.updated_at})
        `,
      })

      const getSessionRow = SqlSchema.findOneOption({
        Request: SessionIdInput,
        Result: SessionWithLastUserMessageRow,
        execute: ({ id }) =>
          sql`${sessionSelection(sql)} WHERE sessions.id = ${id}`,
      })

      const listSessionRows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SessionWithLastUserMessageRow,
        execute: () => sql`
          ${sessionSelection(sql)}
          WHERE sessions.archived_at IS NULL
          ORDER BY COALESCE(last_user_message_at, sessions.updated_at) DESC
        `,
      })

      const insertRunRow = SqlSchema.void({
        Request: CreateRunRowInput,
        execute: (row) => sql`
          INSERT INTO runs (id, session_id, base_node_id, created_at)
          VALUES (${row.id}, ${row.session_id}, ${row.base_node_id}, ${row.created_at})
        `,
      })

      const getRunRow = SqlSchema.findOneOption({
        Request: RunIdInput,
        Result: RunTableRow,
        execute: ({ id }) =>
          sql`SELECT id, session_id, base_node_id, created_at FROM runs WHERE id = ${id}`,
      })

      const insertModelCallRow = SqlSchema.void({
        Request: CreateModelCallRowInput,
        execute: (row) => sql`
          INSERT INTO model_calls (
            id,
            session_id,
            run_id,
            assistant_node_id,
            provider_id,
            model_id,
            billing_mode,
            input_tokens,
            output_tokens,
            reasoning_tokens,
            cache_read_tokens,
            cache_write_tokens,
            total_tokens,
            context_window_tokens,
            actual_cost_micros_usd,
            list_price_micros_usd,
            started_at,
            finished_at
          ) VALUES (
            ${row.id},
            ${row.session_id},
            ${row.run_id},
            ${row.assistant_node_id},
            ${row.provider_id},
            ${row.model_id},
            ${row.billing_mode},
            ${row.input_tokens},
            ${row.output_tokens},
            ${row.reasoning_tokens},
            ${row.cache_read_tokens},
            ${row.cache_write_tokens},
            ${row.total_tokens},
            ${row.context_window_tokens},
            ${row.actual_cost_micros_usd},
            ${row.list_price_micros_usd},
            ${row.started_at},
            ${row.finished_at}
          )
        `,
      })

      const updateSessionTitleRow = SqlSchema.void({
        Request: SetSessionTitleInput,
        execute: (row) =>
          sql`UPDATE sessions SET title = ${row.title}, updated_at = ${row.updated_at} WHERE id = ${row.id}`,
      })

      const archiveProjectSessionRows = SqlSchema.void({
        Request: ArchiveProjectSessionsInput,
        execute: (row) => sql`
          UPDATE sessions SET archived_at = ${row.archived_at}, updated_at = ${row.updated_at}
          WHERE project_id = ${row.project_id} AND archived_at IS NULL
        `,
      })

      const listNodeChainRows = SqlSchema.findAll({
        Request: NodeIdInput,
        Result: MessageNodeRow,
        execute: ({ id }) => sql`
          WITH RECURSIVE chain AS (
            SELECT * FROM nodes WHERE id = ${id}
            UNION ALL
            SELECT n.* FROM nodes n JOIN chain c ON n.id = c.parent_node_id
          )
          ${chainNodeSelection(sql)}
        `,
      })

      const listAllNodeRows = SqlSchema.findAll({
        Request: SessionIdInput,
        Result: MessageNodeRow,
        execute: ({ id }) =>
          sql`${nodeSelection(sql)} WHERE n.session_id = ${id} ORDER BY n.created_at ASC`,
      })

      const findNodeInSessionRow = SqlSchema.findOneOption({
        Request: NodeBelongsToSessionInput,
        Result: NodeIdentityRow,
        execute: (row) =>
          sql`SELECT id FROM nodes WHERE id = ${row.node_id} AND session_id = ${row.session_id}`,
      })

      const listLeafNodeRows = SqlSchema.findAll({
        Request: SessionIdInput,
        Result: MessageNodeRow,
        execute: ({ id }) => sql`
          ${nodeSelection(sql)}
          WHERE n.session_id = ${id}
            AND NOT EXISTS (SELECT 1 FROM nodes child WHERE child.parent_node_id = n.id)
        `,
      })

      const get = Effect.fn('SessionStorage.get')(function* (id: SessionId) {
        const row = yield* getSessionRow({ id }).pipe(
          Effect.mapError(sqlFailure('get', `Failed to get session: ${id}`))
        )
        return yield* Option.match(row, {
          onNone: () =>
            Effect.fail(notFound('get', `Session not found: ${id}`)),
          onSome: (session) => Effect.succeed(toSession(session)),
        })
      })

      const create = Effect.fn('SessionStorage.create')(function* (
        projectId: string,
        title?: string
      ) {
        const id = crypto.randomUUID()
        const now = nowIso()
        yield* insertSessionRow({
          id,
          project_id: projectId,
          title: title ?? null,
          created_at: now,
          updated_at: now,
        }).pipe(
          Effect.mapError(sqlFailure('create', 'Failed to create session'))
        )
        return {
          id,
          projectId,
          title: title ?? null,
          archivedAt: null,
          lastUserMessageAt: null,
          createdAt: Date.parse(now),
          updatedAt: Date.parse(now),
        } satisfies Session
      })

      const list = Effect.fn('SessionStorage.list')(function* () {
        const rows = yield* listSessionRows().pipe(
          Effect.mapError(sqlFailure('list', 'Failed to list sessions'))
        )
        return rows.map(toSession)
      })

      const createRun: SessionStorageApi['createRun'] = Effect.fn(
        'SessionStorage.createRun'
      )(function* (input) {
        yield* insertRunRow({
          id: input.id,
          session_id: input.sessionId,
          base_node_id: input.baseNodeId ?? null,
          created_at: new Date(input.createdAt ?? Date.now()).toISOString(),
        }).pipe(
          Effect.mapError(
            sqlFailure('createRun', `Failed to create run: ${input.id}`)
          )
        )
      })

      const completeRun: SessionStorageApi['completeRun'] = Effect.fn(
        'SessionStorage.completeRun'
      )(function* () {
        // Persisted runs are provenance only; active status remains in server memory.
      })

      const getRun: SessionStorageApi['getRun'] = Effect.fn(
        'SessionStorage.getRun'
      )(function* (id) {
        const row = yield* getRunRow({ id }).pipe(
          Effect.mapError(sqlFailure('getRun', `Failed to get run: ${id}`))
        )
        return yield* Option.match(row, {
          onNone: () => Effect.fail(notFound('getRun', `Run not found: ${id}`)),
          onSome: (run) => Effect.succeed(toRun(run)),
        })
      })

      const createModelCall: SessionStorageApi['createModelCall'] = Effect.fn(
        'SessionStorage.createModelCall'
      )(function* (input) {
        yield* insertModelCallRow({
          id: input.id ?? crypto.randomUUID(),
          session_id: input.sessionId,
          run_id: input.runId,
          assistant_node_id: input.assistantNodeId,
          provider_id: input.providerId,
          model_id: input.modelId,
          billing_mode: input.billingMode,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          reasoning_tokens: input.reasoningTokens,
          cache_read_tokens: input.cacheReadTokens,
          cache_write_tokens: input.cacheWriteTokens,
          total_tokens: input.totalTokens,
          context_window_tokens: input.contextWindowTokens,
          actual_cost_micros_usd: input.actualCostMicrosUsd,
          list_price_micros_usd: input.listPriceMicrosUsd,
          started_at:
            input.startedAt === undefined || input.startedAt === null
              ? null
              : new Date(input.startedAt).toISOString(),
          finished_at: new Date(input.finishedAt ?? Date.now()).toISOString(),
        }).pipe(
          Effect.mapError(
            sqlFailure(
              'createModelCall',
              `Failed to create model call for node: ${input.assistantNodeId}`
            )
          )
        )
      })

      const setTitle: SessionStorageApi['setTitle'] = Effect.fn(
        'SessionStorage.setTitle'
      )(function* (id, title) {
        yield* get(id)
        yield* updateSessionTitleRow({ id, title, updated_at: nowIso() }).pipe(
          Effect.mapError(
            sqlFailure('setTitle', `Failed to set session title: ${id}`)
          )
        )
      })

      const del = Effect.fn('SessionStorage.delete')(function* (id: SessionId) {
        yield* sql`DELETE FROM sessions WHERE id = ${id}`.pipe(
          Effect.mapError(
            sqlFailure('delete', `Failed to delete session: ${id}`)
          )
        )
      })

      const archiveByProject: SessionStorageApi['archiveByProject'] = Effect.fn(
        'SessionStorage.archiveByProject'
      )(function* (projectId) {
        yield* archiveProjectSessionRows({
          project_id: projectId,
          archived_at: Date.now(),
          updated_at: nowIso(),
        }).pipe(
          Effect.mapError(
            sqlFailure(
              'archiveByProject',
              `Failed to archive sessions for project: ${projectId}`
            )
          )
        )
      })

      const conversation = Effect.fn('SessionStorage.conversation')(
        function* (sessionId, headNodeId) {
          yield* get(sessionId)
          const rows =
            headNodeId === null
              ? []
              : yield* listNodeChainRows({ id: headNodeId }).pipe(
                  Effect.mapError(
                    sqlFailure(
                      'conversation',
                      `Failed to load conversation: ${sessionId}`
                    )
                  )
                )
          return Schema.decodeUnknownSync(Prompt.Prompt)({
            content: [...rows].reverse().flatMap((row) => {
              if (row.kind !== 'message' || row.message_content === null)
                return []
              const decoded = decodePromptMessageOption(row.message_content)
              return Option.isNone(decoded) ? [] : [decoded.value]
            }),
          })
        }
      )

      const messages = Effect.fn('SessionStorage.messages')(
        function* (sessionId, headNodeId) {
          yield* get(sessionId)
          if (headNodeId === undefined) {
            const rows = yield* listAllNodeRows({ id: sessionId }).pipe(
              Effect.mapError(
                sqlFailure('messages', `Failed to load messages: ${sessionId}`)
              )
            )
            return rows.map(toMessageNode)
          }
          const rows =
            headNodeId === null
              ? []
              : yield* listNodeChainRows({ id: headNodeId }).pipe(
                  Effect.mapError(
                    sqlFailure(
                      'messages',
                      `Failed to load messages: ${sessionId}`
                    )
                  )
                )
          return [...rows].reverse().map(toMessageNode)
        }
      )

      const append: SessionStorageApi['append'] = Effect.fn(
        'SessionStorage.append'
      )(function* (sessionId, runId, messagesToAppend, baseNodeId) {
        if (messagesToAppend.length === 0) return []
        yield* get(sessionId)
        yield* getRun(runId)
        const parentNodeId = baseNodeId
        if (parentNodeId !== null) {
          const found = yield* findNodeInSessionRow({
            node_id: parentNodeId,
            session_id: sessionId,
          }).pipe(
            Effect.mapError(
              sqlFailure(
                'append',
                `Failed to verify base node: ${parentNodeId}`
              )
            )
          )
          if (Option.isNone(found))
            return yield* Effect.fail(
              notFound(
                'append',
                `Base node ${parentNodeId} not found in session ${sessionId}`
              )
            )
        }
        const now = nowIso()
        const rows = insertRows(
          sessionId,
          runId,
          parentNodeId,
          messagesToAppend,
          now
        )
        yield* sql
          .withTransaction(
            sql`INSERT INTO messages ${sql.insert(rows.messages)}`.pipe(
              Effect.andThen(sql`INSERT INTO nodes ${sql.insert(rows.nodes)}`),
              Effect.andThen(
                sql`UPDATE sessions SET updated_at = ${now} WHERE id = ${sessionId}`
              )
            )
          )
          .pipe(
            Effect.mapError(
              sqlFailure(
                'append',
                `Failed to append messages to session: ${sessionId}`
              )
            )
          )
        return rows.nodes.map((row) => row.id)
      })

      const leaves: SessionStorageApi['leaves'] = Effect.fn(
        'SessionStorage.leaves'
      )(function* (sessionId) {
        yield* get(sessionId)
        const rows = yield* listLeafNodeRows({ id: sessionId }).pipe(
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
        completeRun,
        getRun,
        createModelCall,
        setTitle,
        delete: del,
        archiveByProject,
        conversation,
        messages,
        append,
        leaves,
      } satisfies SessionStorageApi
    })
  )
