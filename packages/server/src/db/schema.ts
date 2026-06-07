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
export type ProviderAuthKind = typeof ProviderAuthKind.Type

export class ProjectTableRow extends Schema.Class<ProjectTableRow>(
  'ProjectTableRow'
)({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
  created_at: UnixMillis,
  updated_at: UnixMillis,
  last_opened_at: Schema.NullOr(UnixMillis),
  archived_at: Schema.NullOr(UnixMillis),
}) {}

export class SessionTableRow extends Schema.Class<SessionTableRow>(
  'SessionTableRow'
)({
  id: SessionId,
  project_id: ProjectId,
  title: Schema.NullOr(Schema.String),
  archived_at: Schema.NullOr(UnixMillis),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
}) {}

export class RunTableRow extends Schema.Class<RunTableRow>('RunTableRow')({
  id: RunId,
  session_id: SessionId,
  base_node_id: Schema.NullOr(NodeId),
  created_at: IsoDateTime,
}) {}

export class MessageTableRow extends Schema.Class<MessageTableRow>(
  'MessageTableRow'
)({
  id: MessageId,
  session_id: SessionId,
  role: MessageRole,
  content: Schema.String,
  created_at: IsoDateTime,
}) {}

export class SummaryTableRow extends Schema.Class<SummaryTableRow>(
  'SummaryTableRow'
)({
  id: SummaryId,
  session_id: SessionId,
  content: Schema.String,
  source_start_node_id: NodeId,
  source_end_node_id: NodeId,
  run_id: Schema.NullOr(RunId),
  created_at: IsoDateTime,
}) {}

export class NodeTableRow extends Schema.Class<NodeTableRow>('NodeTableRow')({
  id: NodeId,
  session_id: SessionId,
  parent_node_id: Schema.NullOr(NodeId),
  kind: NodeKind,
  message_id: Schema.NullOr(MessageId),
  summary_id: Schema.NullOr(SummaryId),
  source_node_id: Schema.NullOr(NodeId),
  run_id: Schema.NullOr(RunId),
  created_at: IsoDateTime,
}) {}

export class ModelCallTableRow extends Schema.Class<ModelCallTableRow>(
  'ModelCallTableRow'
)({
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
}) {}

export class SessionWithLastUserMessageRow extends Schema.Class<SessionWithLastUserMessageRow>(
  'SessionWithLastUserMessageRow'
)({
  ...SessionTableRow.fields,
  last_user_message_at: Schema.NullOr(IsoDateTime),
}) {}

export class MessageNodeRow extends Schema.Class<MessageNodeRow>(
  'MessageNodeRow'
)({
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
  run_created_at: Schema.NullOr(IsoDateTime),
  run_base_node_id: Schema.NullOr(NodeId),
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
}) {}

export class ProviderAuthTableRow extends Schema.Class<ProviderAuthTableRow>(
  'ProviderAuthTableRow'
)({
  provider: Schema.String,
  type: ProviderAuthKind,
  api_key: Schema.NullOr(Schema.String),
  access_token: Schema.NullOr(Schema.String),
  refresh_token: Schema.NullOr(Schema.String),
  expires_at: Schema.NullOr(UnixMillis),
  last_refresh_at: Schema.NullOr(UnixMillis),
  account_id: Schema.NullOr(Schema.String),
  updated_at: UnixMillis,
}) {}

export class TableColumnInfoRow extends Schema.Class<TableColumnInfoRow>(
  'TableColumnInfoRow'
)({
  cid: Schema.Number,
  name: Schema.String,
  type: Schema.String,
  notnull: Schema.Number,
  dflt_value: Schema.NullOr(Schema.String),
  pk: Schema.Number,
}) {}
