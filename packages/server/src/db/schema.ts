import { Schema } from 'effect'

export const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'))
export type ProjectId = typeof ProjectId.Type

export const SessionId = Schema.String.pipe(Schema.brand('SessionId'))
export type SessionId = typeof SessionId.Type

export const RunId = Schema.String.pipe(Schema.brand('RunId'))
export type RunId = typeof RunId.Type

export const NodeId = Schema.String.pipe(Schema.brand('NodeId'))
export type NodeId = typeof NodeId.Type

export const MessageId = Schema.String.pipe(Schema.brand('MessageId'))
export type MessageId = typeof MessageId.Type

export const SummaryId = Schema.String.pipe(Schema.brand('SummaryId'))
export type SummaryId = typeof SummaryId.Type

export const UnixMillis = Schema.Number.pipe(Schema.brand('UnixMillis'))
export type UnixMillis = typeof UnixMillis.Type

export const IsoDateTime = Schema.String.pipe(Schema.brand('IsoDateTime'))
export type IsoDateTime = typeof IsoDateTime.Type

export const MessageRole = Schema.Literals([
  'system',
  'user',
  'assistant',
  'reasoning',
  'tool',
])
export type MessageRole = typeof MessageRole.Type

export const NodeKind = Schema.Literals(['message', 'summary'])
export type NodeKind = typeof NodeKind.Type

export const ProviderAuthKind = Schema.Literals(['api', 'oauth'])

export const RunStatus = Schema.Literals([
  'running',
  'completed',
  'interrupted',
  'failed',
])
export type RunStatus = typeof RunStatus.Type
export type ProviderAuthKind = typeof ProviderAuthKind.Type

export const ProjectTableRow = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
  created_at: UnixMillis,
  updated_at: UnixMillis,
  last_opened_at: Schema.NullOr(UnixMillis),
  archived_at: Schema.NullOr(UnixMillis),
})
export interface ProjectTableRow extends Schema.Schema.Type<
  typeof ProjectTableRow
> {}

export const SessionTableRow = Schema.Struct({
  id: SessionId,
  project_id: ProjectId,
  title: Schema.NullOr(Schema.String),
  archived_at: Schema.NullOr(UnixMillis),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
})
export interface SessionTableRow extends Schema.Schema.Type<
  typeof SessionTableRow
> {}

export const RunTableRow = Schema.Struct({
  id: RunId,
  session_id: SessionId,
  base_node_id: Schema.NullOr(NodeId),
  status: RunStatus,
  completed_at: Schema.NullOr(IsoDateTime),
  created_at: IsoDateTime,
})
export interface RunTableRow extends Schema.Schema.Type<typeof RunTableRow> {}

export const MessageTableRow = Schema.Struct({
  id: MessageId,
  session_id: SessionId,
  role: MessageRole,
  content: Schema.String,
  created_at: IsoDateTime,
})
export interface MessageTableRow extends Schema.Schema.Type<
  typeof MessageTableRow
> {}

export const SummaryTableRow = Schema.Struct({
  id: SummaryId,
  session_id: SessionId,
  content: Schema.String,
  source_start_node_id: NodeId,
  source_end_node_id: NodeId,
  run_id: Schema.NullOr(RunId),
  created_at: IsoDateTime,
})
export interface SummaryTableRow extends Schema.Schema.Type<
  typeof SummaryTableRow
> {}

export const NodeTableRow = Schema.Struct({
  id: NodeId,
  session_id: SessionId,
  parent_node_id: Schema.NullOr(NodeId),
  kind: NodeKind,
  message_id: Schema.NullOr(MessageId),
  summary_id: Schema.NullOr(SummaryId),
  source_node_id: Schema.NullOr(NodeId),
  run_id: Schema.NullOr(RunId),
  created_at: IsoDateTime,
})
export interface NodeTableRow extends Schema.Schema.Type<typeof NodeTableRow> {}

export const ModelCallTableRow = Schema.Struct({
  id: Schema.String,
  session_id: SessionId,
  run_id: Schema.NullOr(RunId),
  assistant_node_id: NodeId,
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
  started_at: Schema.NullOr(IsoDateTime),
  finished_at: IsoDateTime,
})
export interface ModelCallTableRow extends Schema.Schema.Type<
  typeof ModelCallTableRow
> {}

export const SessionWithLastUserMessageRow = Schema.Struct({
  ...SessionTableRow.fields,
  last_user_message_at: Schema.NullOr(IsoDateTime),
})
export interface SessionWithLastUserMessageRow extends Schema.Schema.Type<
  typeof SessionWithLastUserMessageRow
> {}

export const MessageNodeRow = Schema.Struct({
  id: NodeId,
  session_id: SessionId,
  parent_node_id: Schema.NullOr(NodeId),
  kind: NodeKind,
  message_id: Schema.NullOr(MessageId),
  summary_id: Schema.NullOr(SummaryId),
  source_node_id: Schema.NullOr(NodeId),
  run_id: Schema.NullOr(RunId),
  created_at: IsoDateTime,
  message_role: Schema.NullOr(MessageRole),
  message_content: Schema.NullOr(Schema.String),
  message_created_at: Schema.NullOr(IsoDateTime),
  summary_content: Schema.NullOr(Schema.String),
  summary_source_start_node_id: Schema.NullOr(NodeId),
  summary_source_end_node_id: Schema.NullOr(NodeId),
  summary_created_at: Schema.NullOr(IsoDateTime),
  run_created_at: Schema.NullOr(IsoDateTime),
  run_base_node_id: Schema.NullOr(NodeId),
  run_status: Schema.NullOr(RunStatus),
  run_completed_at: Schema.NullOr(IsoDateTime),
  model_call_id: Schema.NullOr(Schema.String),
  model_call_provider_id: Schema.NullOr(Schema.String),
  model_call_model_id: Schema.NullOr(Schema.String),
  model_call_billing_mode: Schema.NullOr(
    Schema.Literals(['api-key', 'subscription'])
  ),
  model_call_input_tokens: Schema.NullOr(Schema.Number),
  model_call_output_tokens: Schema.NullOr(Schema.Number),
  model_call_reasoning_tokens: Schema.NullOr(Schema.Number),
  model_call_cache_read_tokens: Schema.NullOr(Schema.Number),
  model_call_cache_write_tokens: Schema.NullOr(Schema.Number),
  model_call_total_tokens: Schema.NullOr(Schema.Number),
  model_call_context_window_tokens: Schema.NullOr(Schema.Number),
  model_call_actual_cost_micros_usd: Schema.NullOr(Schema.Number),
  model_call_list_price_micros_usd: Schema.NullOr(Schema.Number),
  model_call_started_at: Schema.NullOr(IsoDateTime),
  model_call_finished_at: Schema.NullOr(IsoDateTime),
})
export interface MessageNodeRow extends Schema.Schema.Type<
  typeof MessageNodeRow
> {}

export const DurableSyncEventTableRow = Schema.Struct({
  sequence: Schema.Number,
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
export interface DurableSyncEventTableRow extends Schema.Schema.Type<
  typeof DurableSyncEventTableRow
> {}

export const ProviderAuthTableRow = Schema.Struct({
  provider: Schema.String,
  type: ProviderAuthKind,
  api_key: Schema.NullOr(Schema.String),
  access_token: Schema.NullOr(Schema.String),
  refresh_token: Schema.NullOr(Schema.String),
  expires_at: Schema.NullOr(UnixMillis),
  last_refresh_at: Schema.NullOr(UnixMillis),
  account_id: Schema.NullOr(Schema.String),
  updated_at: UnixMillis,
})
export interface ProviderAuthTableRow extends Schema.Schema.Type<
  typeof ProviderAuthTableRow
> {}

export const TableColumnInfoRow = Schema.Struct({
  cid: Schema.Number,
  name: Schema.String,
  type: Schema.String,
  notnull: Schema.Number,
  dflt_value: Schema.NullOr(Schema.String),
  pk: Schema.Number,
})
export interface TableColumnInfoRow extends Schema.Schema.Type<
  typeof TableColumnInfoRow
> {}
