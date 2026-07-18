/** SqliteSession — node/content session storage backed by Effect SQL. */
import { Effect, Layer, Option, Schema } from 'effect'
import { Prompt } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'
import {
  DurableSyncEventTableRow,
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
  type NodeId,
  type Run,
  type RunId,
  type Session,
  type SessionId,
  type SessionStorageApi,
  type StoredMessageEncoded,
} from './session.ts'
import {
  ActiveRunSummary,
  MessageNodeResponse,
  type DurableServerEvent,
} from '@sorato/api'
import { toMessageNodeResponse } from '../message-node-response.ts'

const SessionIdInput = Schema.Struct({ id: Schema.String })
const RunIdInput = Schema.Struct({ id: Schema.String })
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
const CompletedRunRow = Schema.Struct({ session_id: Schema.String })
const SequenceRow = Schema.Struct({ sequence: Schema.Number })
const NodeIdsInput = Schema.Struct({ node_ids: Schema.Array(Schema.String) })
const SequenceInput = Schema.Struct({ sequence: Schema.Number })
const InsertDurableSyncEventInput = Schema.Struct({
  event_type: Schema.Literals([
    'node_batch_committed',
    'active_run_upserted',
    'run_end',
    'session_title_updated',
  ]),
  session_id: Schema.String,
  run_id: Schema.NullOr(Schema.String),
  payload: Schema.String,
  created_at: Schema.Number,
})
const DurableSyncPayload = Schema.Union([
  Schema.TaggedStruct('NodeBatchCommitted', {
    sessionId: Schema.String,
    runId: Schema.String,
    nodes: Schema.Array(MessageNodeResponse),
    headNodeId: Schema.String,
    sessionUpdatedAt: Schema.Number,
    contentThroughEventId: Schema.optional(Schema.Number),
  }),
  Schema.TaggedStruct('ActiveRunUpserted', {
    ...ActiveRunSummary.fields,
  }),
  Schema.TaggedStruct('RunEnd', {
    sessionId: Schema.String,
    runId: Schema.String,
  }),
  Schema.TaggedStruct('SessionTitleUpdated', {
    sessionId: Schema.String,
    title: Schema.String,
    updatedAt: Schema.Number,
  }),
])

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

type CompactNodeInsertRow = {
  readonly id: string
  readonly session_id: string
  readonly parent_node_id: string | null
  readonly kind: 'message' | 'summary'
  readonly message_id: string | null
  readonly summary_id: string | null
  readonly source_node_id: string | null
  readonly run_id: string | null
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
  status: row.status,
  providerId: 'unknown',
  modelId: 'unknown',
  billingMode: 'api-key',
  baseNodeId: row.base_node_id,
  ...emptyUsage,
  createdAt: Date.parse(row.created_at),
  completedAt: toMillis(row.completed_at),
})

const runFromNodeRow = (row: NodeRow): Run | null =>
  row.run_id === null || row.run_created_at === null
    ? null
    : {
        id: row.run_id,
        sessionId: row.session_id,
        status: row.run_status ?? 'completed',
        providerId: row.model_call_provider_id ?? 'unknown',
        modelId: row.model_call_model_id ?? 'unknown',
        billingMode: row.model_call_billing_mode ?? 'api-key',
        baseNodeId: row.run_base_node_id,
        ...emptyUsage,
        createdAt: Date.parse(row.run_created_at),
        completedAt: toMillis(row.run_completed_at),
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

const isBootstrapSystemRow = (row: NodeRow): boolean => {
  if (row.kind !== 'message' || row.message_role !== 'system') return false
  const content = row.message_content
  if (content === null) return false
  const message = decodeStoredMessage(content)
  return (
    message.role === 'system' &&
    (message.source === 'system-prompt' || message.source === 'agents-md')
  )
}

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

const summaryMessageContent = (content: string): string =>
  [
    'This is a summary of earlier conversation messages, generated to preserve context while reducing transcript length.',
    '<summary>',
    content,
    '</summary>',
  ].join('\n')

const summaryDisplayContent = (content: string): string => {
  const match = content.match(/<summary>\n([\s\S]*)\n<\/summary>$/)
  return match?.[1] ?? content
}

const summaryModelContent = (content: string): string =>
  content.includes('<summary>') ? content : summaryMessageContent(content)

const summaryEncoded = (content: string): StoredMessageEncoded =>
  Schema.decodeUnknownSync(StoredMessage)({
    role: 'user',
    content: summaryModelContent(content),
    source: 'summary',
    display: { title: 'Summary' },
    metadata: { summary: { content: summaryDisplayContent(content) } },
  })

const promptSummaryEncoded = (content: string): Prompt.MessageEncoded =>
  Schema.decodeUnknownSync(Prompt.Message)({
    role: 'user',
    content: summaryModelContent(content),
  })

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
  encoded:
    row.kind === 'summary'
      ? summaryEncoded(row.summary_content ?? '')
      : decodeStoredMessage(
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
    s.content AS summary_content,
    s.source_start_node_id AS summary_source_start_node_id,
    s.source_end_node_id AS summary_source_end_node_id,
    s.created_at AS summary_created_at,
    r.created_at AS run_created_at,
    r.base_node_id AS run_base_node_id,
    r.status AS run_status,
    r.completed_at AS run_completed_at,
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
  LEFT JOIN summaries s ON s.id = n.summary_id
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
    s.content AS summary_content,
    s.source_start_node_id AS summary_source_start_node_id,
    s.source_end_node_id AS summary_source_end_node_id,
    s.created_at AS summary_created_at,
    r.created_at AS run_created_at,
    r.base_node_id AS run_base_node_id,
    r.status AS run_status,
    r.completed_at AS run_completed_at,
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
  LEFT JOIN summaries s ON s.id = n.summary_id
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
          INSERT INTO runs (id, session_id, base_node_id, status, created_at)
          VALUES (${row.id}, ${row.session_id}, ${row.base_node_id}, 'running', ${row.created_at})
        `,
      })

      const getRunRow = SqlSchema.findOneOption({
        Request: RunIdInput,
        Result: RunTableRow,
        execute: ({ id }) =>
          sql`SELECT id, session_id, base_node_id, status, completed_at, created_at FROM runs WHERE id = ${id}`,
      })

      const completeRunRow = SqlSchema.findOneOption({
        Request: Schema.Struct({
          id: RunIdInput.fields.id,
          status: Schema.Literals(['completed', 'interrupted', 'failed']),
          completed_at: Schema.String,
        }),
        execute: (row) => sql`
          UPDATE runs
          SET status = ${row.status}, completed_at = ${row.completed_at}
          WHERE id = ${row.id} AND status = 'running'
          RETURNING session_id
        `,
        Result: CompletedRunRow,
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

      const insertDurableSyncEventRow = SqlSchema.findOne({
        Request: InsertDurableSyncEventInput,
        Result: SequenceRow,
        execute: (row) => sql`
          INSERT INTO durable_sync_events (
            event_type,
            session_id,
            run_id,
            payload,
            created_at
          ) VALUES (
            ${row.event_type},
            ${row.session_id},
            ${row.run_id},
            ${row.payload},
            ${row.created_at}
          )
          RETURNING sequence
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
        Request: NodeBelongsToSessionInput,
        Result: MessageNodeRow,
        execute: (row) => sql`
          WITH RECURSIVE chain AS (
            SELECT * FROM nodes
            WHERE id = ${row.node_id} AND session_id = ${row.session_id}
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
          sql`${nodeSelection(sql)} WHERE n.session_id = ${id} ORDER BY n.created_at ASC, n.rowid ASC`,
      })

      const listNodeRowsByIds = SqlSchema.findAll({
        Request: NodeIdsInput,
        Result: MessageNodeRow,
        execute: ({ node_ids }) =>
          sql`${nodeSelection(sql)} WHERE ${sql.in('n.id', node_ids)}`,
      })

      const getMaxMutationSequence = SqlSchema.findOne({
        Request: Schema.Void,
        Result: SequenceRow,
        execute: () => sql`
          SELECT COALESCE(MAX(sequence), 0) AS sequence
          FROM durable_sync_events
        `,
      })

      const listDurableSyncEventRows = SqlSchema.findAll({
        Request: SequenceInput,
        Result: DurableSyncEventTableRow,
        execute: ({ sequence }) => sql`
          SELECT
            sequence,
            event_type,
            session_id,
            run_id,
            payload,
            created_at
          FROM durable_sync_events
          WHERE sequence > ${sequence}
          ORDER BY sequence ASC
        `,
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

      const get: SessionStorageApi['get'] = Effect.fn('SessionStorage.get')(
        function* (id: SessionId) {
          const row = yield* getSessionRow({ id }).pipe(
            Effect.mapError(sqlFailure('get', `Failed to get session: ${id}`))
          )
          return yield* Option.match(row, {
            onNone: () =>
              Effect.fail(notFound('get', `Session not found: ${id}`)),
            onSome: (session) => Effect.succeed(toSession(session)),
          })
        }
      )

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

      const findRun: SessionStorageApi['findRun'] = Effect.fn(
        'SessionStorage.findRun'
      )(function* (id) {
        const row = yield* getRunRow({ id }).pipe(
          Effect.mapError(sqlFailure('findRun', `Failed to find run: ${id}`))
        )
        return Option.match(row, {
          onNone: () => null,
          onSome: toRun,
        })
      })

      const completeRun: SessionStorageApi['completeRun'] = Effect.fn(
        'SessionStorage.completeRun'
      )(function* (input) {
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const completedAt = input.completedAt ?? Date.now()
              const completed = yield* completeRunRow({
                id: input.id,
                status: input.status,
                completed_at: new Date(completedAt).toISOString(),
              })
              if (Option.isNone(completed)) {
                yield* getRun(input.id)
                return null
              }
              const payload = {
                _tag: 'RunEnd' as const,
                sessionId: completed.value.session_id,
                runId: input.id,
              }
              const { sequence } = yield* insertDurableSyncEventRow({
                event_type: 'run_end',
                session_id: completed.value.session_id,
                run_id: input.id,
                payload: JSON.stringify(payload),
                created_at: completedAt,
              })
              return { ...payload, sequence }
            })
          )
          .pipe(
            Effect.mapError(
              sqlFailure('completeRun', `Failed to complete run: ${input.id}`)
            )
          )
      })

      const setTitle: SessionStorageApi['setTitle'] = Effect.fn(
        'SessionStorage.setTitle'
      )(function* (id, title) {
        const updatedAt = nowIso()
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* get(id)
              yield* updateSessionTitleRow({
                id,
                title,
                updated_at: updatedAt,
              })
              const payload = {
                _tag: 'SessionTitleUpdated' as const,
                sessionId: id,
                title,
                updatedAt: Date.parse(updatedAt),
              }
              const { sequence } = yield* insertDurableSyncEventRow({
                event_type: 'session_title_updated',
                session_id: id,
                run_id: null,
                payload: JSON.stringify(payload),
                created_at: payload.updatedAt,
              })
              return { ...payload, sequence }
            })
          )
          .pipe(
            Effect.mapError(
              sqlFailure('setTitle', `Failed to set session title: ${id}`)
            )
          )
      })

      const appendActiveRunUpsert: SessionStorageApi['appendActiveRunUpsert'] =
        Effect.fn('SessionStorage.appendActiveRunUpsert')(function* (input) {
          const activeRun = yield* Schema.decodeUnknownEffect(ActiveRunSummary)(
            input
          ).pipe(
            Effect.mapError(
              sqlFailure('appendActiveRunUpsert', 'Invalid active run summary')
            )
          )
          const run = yield* getRun(activeRun.runId)
          if (run.sessionId !== activeRun.sessionId) {
            return yield* Effect.fail(
              new StorageError({
                operation: 'appendActiveRunUpsert',
                message: `Run ${activeRun.runId} does not belong to session ${activeRun.sessionId}`,
              })
            )
          }
          if (run.status !== 'running') {
            return yield* Effect.fail(
              new StorageError({
                operation: 'appendActiveRunUpsert',
                message: `Run ${activeRun.runId} is not active`,
              })
            )
          }
          const createdAt = Date.now()
          const payload = {
            _tag: 'ActiveRunUpserted' as const,
            ...activeRun,
          }
          const { sequence } = yield* insertDurableSyncEventRow({
            event_type: 'active_run_upserted',
            session_id: activeRun.sessionId,
            run_id: activeRun.runId,
            payload: JSON.stringify(payload),
            created_at: createdAt,
          }).pipe(
            Effect.mapError(
              sqlFailure(
                'appendActiveRunUpsert',
                `Failed to persist active run: ${activeRun.runId}`
              )
            )
          )
          return { ...payload, sequence }
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

      const conversation: SessionStorageApi['conversation'] = Effect.fn(
        'SessionStorage.conversation'
      )(function* (sessionId: SessionId, headNodeId: NodeId | null) {
        yield* get(sessionId)
        const rows =
          headNodeId === null
            ? []
            : yield* listNodeChainRows({
                node_id: headNodeId,
                session_id: sessionId,
              }).pipe(
                Effect.mapError(
                  sqlFailure(
                    'conversation',
                    `Failed to load conversation: ${sessionId}`
                  )
                )
              )
        return Schema.decodeUnknownSync(Prompt.Prompt)({
          content: [...rows].reverse().flatMap((row) => {
            if (row.kind === 'summary') {
              return [promptSummaryEncoded(row.summary_content ?? '')]
            }
            if (row.message_content === null) return []
            const decoded = decodePromptMessageOption(row.message_content)
            return Option.isNone(decoded) ? [] : [decoded.value]
          }),
        })
      })

      const messages: SessionStorageApi['messages'] = Effect.fn(
        'SessionStorage.messages'
      )(function* (sessionId: SessionId, headNodeId?: NodeId | null) {
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
            : yield* listNodeChainRows({
                node_id: headNodeId,
                session_id: sessionId,
              }).pipe(
                Effect.mapError(
                  sqlFailure(
                    'messages',
                    `Failed to load messages: ${sessionId}`
                  )
                )
              )
        return [...rows].reverse().map(toMessageNode)
      })

      const loadNodesByIds = Effect.fn('SessionStorage.loadNodesByIds')(
        function* (nodeIds: ReadonlyArray<string>, operation: string) {
          if (nodeIds.length === 0) return []
          const rows = yield* listNodeRowsByIds({ node_ids: nodeIds }).pipe(
            Effect.mapError(
              sqlFailure(operation, 'Failed to load committed message nodes')
            )
          )
          const rowsById = new Map<string, NodeRow>(
            rows.map((row) => [row.id, row])
          )
          return yield* Effect.forEach(nodeIds, (nodeId) => {
            const row = rowsById.get(nodeId)
            return row === undefined
              ? Effect.fail(
                  notFound(operation, `Committed node not found: ${nodeId}`)
                )
              : Effect.succeed(toMessageNode(row))
          })
        }
      )

      const conversationSnapshot: SessionStorageApi['conversationSnapshot'] =
        Effect.fn('SessionStorage.conversationSnapshot')(function* (sessionId) {
          return yield* sql
            .withTransaction(
              Effect.gen(function* () {
                yield* get(sessionId)
                const rows = yield* listAllNodeRows({ id: sessionId })
                const { sequence } = yield* getMaxMutationSequence()
                return { sequence, nodes: rows.map(toMessageNode) }
              })
            )
            .pipe(
              Effect.mapError(
                sqlFailure(
                  'conversationSnapshot',
                  `Failed to load conversation snapshot: ${sessionId}`
                )
              )
            )
        })

      const durableEventsAfter: SessionStorageApi['durableEventsAfter'] =
        Effect.fn('SessionStorage.durableEventsAfter')(function* (sequence) {
          return yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const events = yield* listDurableSyncEventRows({
                  sequence,
                })
                return yield* Effect.forEach(events, (event) =>
                  Effect.try({
                    try: (): DurableServerEvent => {
                      const payload = Schema.decodeUnknownSync(
                        DurableSyncPayload
                      )(JSON.parse(event.payload))
                      return { ...payload, sequence: event.sequence }
                    },
                    catch: (error) =>
                      new StorageError({
                        operation: 'durableEventsAfter',
                        message: `Failed to decode durable event ${event.sequence}`,
                        error,
                      }),
                  })
                )
              })
            )
            .pipe(
              Effect.mapError(
                sqlFailure(
                  'durableEventsAfter',
                  `Failed to replay durable events after ${sequence}`
                )
              )
            )
        })

      const commitNodeBatch: SessionStorageApi['commitNodeBatch'] = Effect.fn(
        'SessionStorage.commitNodeBatch'
      )(function* (input) {
        if (input.messages.length === 0) return null
        const { sessionId, runId, baseNodeId } = input
        yield* get(sessionId)
        const run = yield* getRun(runId)
        if (run.sessionId !== sessionId) {
          return yield* Effect.fail(
            new StorageError({
              operation: 'commitNodeBatch',
              message: `Run ${runId} does not belong to session ${sessionId}`,
            })
          )
        }
        const parentNodeId = baseNodeId
        if (parentNodeId !== null) {
          const found = yield* findNodeInSessionRow({
            node_id: parentNodeId,
            session_id: sessionId,
          }).pipe(
            Effect.mapError(
              sqlFailure(
                'commitNodeBatch',
                `Failed to verify base node: ${parentNodeId}`
              )
            )
          )
          if (Option.isNone(found))
            return yield* Effect.fail(
              notFound(
                'commitNodeBatch',
                `Base node ${parentNodeId} not found in session ${sessionId}`
              )
            )
        }
        const now = nowIso()
        const rows = insertRows(
          sessionId,
          runId,
          parentNodeId,
          input.messages,
          now
        )
        const modelCallRows = yield* Effect.forEach(
          input.modelCalls ?? [],
          (modelCall) => {
            const node = rows.nodes[modelCall.messageIndex]
            const message = input.messages[modelCall.messageIndex]
            if (node === undefined || message?.role !== 'assistant') {
              return Effect.fail(
                new StorageError({
                  operation: 'commitNodeBatch',
                  message: `Model call index ${modelCall.messageIndex} does not identify an assistant message`,
                })
              )
            }
            return Effect.succeed({
              id: modelCall.id ?? crypto.randomUUID(),
              session_id: sessionId,
              run_id: runId,
              assistant_node_id: node.id,
              provider_id: modelCall.providerId,
              model_id: modelCall.modelId,
              billing_mode: modelCall.billingMode,
              input_tokens: modelCall.inputTokens,
              output_tokens: modelCall.outputTokens,
              reasoning_tokens: modelCall.reasoningTokens,
              cache_read_tokens: modelCall.cacheReadTokens,
              cache_write_tokens: modelCall.cacheWriteTokens,
              total_tokens: modelCall.totalTokens,
              context_window_tokens: modelCall.contextWindowTokens,
              actual_cost_micros_usd: modelCall.actualCostMicrosUsd,
              list_price_micros_usd: modelCall.listPriceMicrosUsd,
              started_at:
                modelCall.startedAt === undefined ||
                modelCall.startedAt === null
                  ? null
                  : new Date(modelCall.startedAt).toISOString(),
              finished_at: new Date(
                modelCall.finishedAt ?? Date.now()
              ).toISOString(),
            })
          }
        )
        const headNodeId = rows.nodes.at(-1)?.id
        if (headNodeId === undefined) return null
        const committed = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO messages ${sql.insert(rows.messages)}`
              yield* sql`INSERT INTO nodes ${sql.insert(rows.nodes)}`
              yield* Effect.forEach(modelCallRows, insertModelCallRow, {
                discard: true,
              })
              yield* sql`UPDATE sessions SET updated_at = ${now} WHERE id = ${sessionId}`
              const nodes = yield* loadNodesByIds(
                rows.nodes.map((row) => row.id),
                'commitNodeBatch'
              )
              const payload = {
                _tag: 'NodeBatchCommitted' as const,
                sessionId,
                runId,
                nodes: nodes.map(toMessageNodeResponse),
                headNodeId,
                sessionUpdatedAt: Date.parse(now),
                ...(input.contentThroughEventId === undefined
                  ? {}
                  : { contentThroughEventId: input.contentThroughEventId }),
              }
              const { sequence } = yield* insertDurableSyncEventRow({
                event_type: 'node_batch_committed',
                session_id: sessionId,
                run_id: runId,
                payload: JSON.stringify(payload),
                created_at: Date.parse(now),
              })
              return { sequence, nodes }
            })
          )
          .pipe(
            Effect.mapError(
              sqlFailure(
                'commitNodeBatch',
                `Failed to append messages to session: ${sessionId}`
              )
            )
          )
        return {
          sequence: committed.sequence,
          sessionId,
          runId,
          nodes: committed.nodes,
          headNodeId,
          sessionUpdatedAt: Date.parse(now),
          ...(input.contentThroughEventId === undefined
            ? {}
            : { contentThroughEventId: input.contentThroughEventId }),
        }
      })

      const compactRange: SessionStorageApi['compactRange'] = Effect.fn(
        'SessionStorage.compactRange'
      )(function* (input) {
        yield* get(input.sessionId)
        const run = yield* getRun(input.runId)
        if (run.sessionId !== input.sessionId) {
          return yield* Effect.fail(
            new StorageError({
              operation: 'compactRange',
              message: `Run ${input.runId} does not belong to session ${input.sessionId}`,
            })
          )
        }
        const rows = yield* listNodeChainRows({
          node_id: input.baseHeadNodeId,
          session_id: input.sessionId,
        }).pipe(
          Effect.mapError(
            sqlFailure(
              'compactRange',
              `Failed to load compact range path: ${input.sessionId}`
            )
          )
        )
        const path = [...rows].reverse()
        const startIndex = path.findIndex((row) => row.id === input.startNodeId)
        const endIndex = path.findIndex((row) => row.id === input.endNodeId)
        if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
          return yield* Effect.fail(
            notFound(
              'compactRange',
              'Compact range must be ordered on the selected head ancestry path'
            )
          )
        }
        if (
          path
            .slice(startIndex, endIndex + 1)
            .some((row) => isBootstrapSystemRow(row))
        ) {
          return yield* Effect.fail(
            notFound(
              'compactRange',
              'Compact range cannot include bootstrap system messages'
            )
          )
        }

        const now = nowIso()
        const summaryId = crypto.randomUUID()
        const summaryNodeId = crypto.randomUUID()
        const parentNodeId = path[startIndex]?.parent_node_id ?? null
        let nextParentNodeId = summaryNodeId
        const cloneRows: CompactNodeInsertRow[] = []

        for (const row of path.slice(endIndex + 1)) {
          const nodeId = crypto.randomUUID()
          cloneRows.push({
            id: nodeId,
            session_id: input.sessionId,
            parent_node_id: nextParentNodeId,
            kind: row.kind,
            message_id: row.message_id,
            summary_id: row.summary_id,
            source_node_id: row.source_node_id ?? row.id,
            run_id: row.run_id,
            created_at: now,
          })
          nextParentNodeId = nodeId
        }

        const summaryNode: CompactNodeInsertRow = {
          id: summaryNodeId,
          session_id: input.sessionId,
          parent_node_id: parentNodeId,
          kind: 'summary',
          message_id: null,
          summary_id: summaryId,
          source_node_id: null,
          run_id: input.runId,
          created_at: now,
        }

        const committedNodeRows = [summaryNode, ...cloneRows]
        const committed = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`
              INSERT INTO summaries (
                id,
                session_id,
                content,
                source_start_node_id,
                source_end_node_id,
                run_id,
                created_at
              ) VALUES (
                ${summaryId},
                ${input.sessionId},
                ${summaryMessageContent(input.summaryContent)},
                ${input.startNodeId},
                ${input.endNodeId},
                ${input.runId},
                ${now}
              )
              `
              yield* sql`INSERT INTO nodes ${sql.insert([summaryNode])}`
              if (cloneRows.length > 0) {
                yield* sql`INSERT INTO nodes ${sql.insert(cloneRows)}`
              }
              yield* sql`UPDATE sessions SET updated_at = ${now} WHERE id = ${input.sessionId}`
              const nodes = yield* loadNodesByIds(
                committedNodeRows.map((row) => row.id),
                'compactRange'
              )
              const payload = {
                _tag: 'NodeBatchCommitted' as const,
                sessionId: input.sessionId,
                runId: input.runId,
                nodes: nodes.map(toMessageNodeResponse),
                headNodeId: nextParentNodeId,
                sessionUpdatedAt: Date.parse(now),
                ...(input.contentThroughEventId === undefined
                  ? {}
                  : { contentThroughEventId: input.contentThroughEventId }),
              }
              const { sequence } = yield* insertDurableSyncEventRow({
                event_type: 'node_batch_committed',
                session_id: input.sessionId,
                run_id: input.runId,
                payload: JSON.stringify(payload),
                created_at: Date.parse(now),
              })
              return { sequence, nodes }
            })
          )
          .pipe(
            Effect.mapError(
              sqlFailure(
                'compactRange',
                `Failed to compact range for session: ${input.sessionId}`
              )
            )
          )

        return {
          summaryNodeId,
          batch: {
            sequence: committed.sequence,
            sessionId: input.sessionId,
            runId: input.runId,
            nodes: committed.nodes,
            headNodeId: nextParentNodeId,
            sessionUpdatedAt: Date.parse(now),
            ...(input.contentThroughEventId === undefined
              ? {}
              : { contentThroughEventId: input.contentThroughEventId }),
          },
        }
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
        getRun,
        findRun,
        completeRun,
        setTitle,
        appendActiveRunUpsert,
        delete: del,
        archiveByProject,
        conversation,
        messages,
        conversationSnapshot,
        durableEventsAfter,
        commitNodeBatch,
        compactRange,
        leaves,
      } satisfies SessionStorageApi
    })
  )
