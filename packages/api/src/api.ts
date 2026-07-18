/**
 * HTTP API definition for Sorato.
 *
 * Pure schema — no runtime behavior. Shared by the server implementation and
 * the web client's generated HttpApiClient.
 */
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import { Effect, Schema } from 'effect'
import { StoredMessage } from '@sorato/core/message'

export const ProjectId = Schema.String
export type ProjectId = string

export const SessionId = Schema.String
export type SessionId = string

export interface StorageErrorLike {
  readonly operation: string
  readonly message: string
}

export interface ProjectErrorLike {
  readonly operation: string
  readonly message: string
}

// ── Schemas ─────────────────────────────────────────────────────────

export const ActiveRunSummary = Schema.Struct({
  sessionId: Schema.String,
  runId: Schema.String,
  baseNodeId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(['agent', 'summary']),
  visibility: Schema.Literals(['primary', 'background']),
  title: Schema.optional(Schema.String),
  parentRunId: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
}).annotate({ identifier: 'ActiveRunSummary' })
export interface ActiveRunSummary extends Schema.Schema.Type<
  typeof ActiveRunSummary
> {}

export const SessionResponse = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.NullOr(Schema.String),
  /** Ephemeral run status — 'running' if an agent run is active. */
  status: Schema.Literals(['idle', 'running']),
  archivedAt: Schema.NullOr(Schema.Number),
  lastUserMessageAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  activeRuns: Schema.optional(Schema.Array(ActiveRunSummary)),
}).annotate({ identifier: 'SessionResponse' })
export interface SessionResponse extends Schema.Schema.Type<
  typeof SessionResponse
> {}

export const RunUsageResponse = Schema.Struct({
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  reasoningTokens: Schema.NullOr(Schema.Number),
  cacheReadTokens: Schema.NullOr(Schema.Number),
  cacheWriteTokens: Schema.NullOr(Schema.Number),
  totalTokens: Schema.NullOr(Schema.Number),
  contextWindowTokens: Schema.NullOr(Schema.Number),
  actualCostMicrosUsd: Schema.NullOr(Schema.Number),
  listPriceMicrosUsd: Schema.NullOr(Schema.Number),
}).annotate({ identifier: 'RunUsageResponse' })
export interface RunUsageResponse extends Schema.Schema.Type<
  typeof RunUsageResponse
> {}

export const RunSummaryResponse = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(['running', 'completed', 'interrupted', 'failed']),
  providerId: Schema.String,
  modelId: Schema.String,
  billingMode: Schema.Literals(['api-key', 'subscription']),
  usage: RunUsageResponse,
  createdAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
}).annotate({ identifier: 'RunSummaryResponse' })
export interface RunSummaryResponse extends Schema.Schema.Type<
  typeof RunSummaryResponse
> {}

export const MessageNodeResponse = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(['message', 'summary']),
  messageId: Schema.NullOr(Schema.String),
  summaryId: Schema.NullOr(Schema.String),
  sourceNodeId: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  run: Schema.NullOr(RunSummaryResponse),
  modelCall: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      sessionId: Schema.String,
      runId: Schema.NullOr(Schema.String),
      assistantNodeId: Schema.String,
      providerId: Schema.String,
      modelId: Schema.String,
      billingMode: Schema.Literals(['api-key', 'subscription']),
      inputTokens: Schema.NullOr(Schema.Number),
      outputTokens: Schema.NullOr(Schema.Number),
      reasoningTokens: Schema.NullOr(Schema.Number),
      cacheReadTokens: Schema.NullOr(Schema.Number),
      cacheWriteTokens: Schema.NullOr(Schema.Number),
      totalTokens: Schema.NullOr(Schema.Number),
      contextWindowTokens: Schema.NullOr(Schema.Number),
      actualCostMicrosUsd: Schema.NullOr(Schema.Number),
      listPriceMicrosUsd: Schema.NullOr(Schema.Number),
      startedAt: Schema.NullOr(Schema.Number),
      finishedAt: Schema.Number,
    })
  ),
  encoded: Schema.toEncoded(StoredMessage),
  createdAt: Schema.Number,
}).annotate({ identifier: 'MessageNodeResponse' })
export interface MessageNodeResponse extends Schema.Schema.Type<
  typeof MessageNodeResponse
> {}

export const ConversationSnapshot = Schema.Struct({
  sequence: Schema.Number,
  nodes: Schema.Array(MessageNodeResponse),
}).annotate({ identifier: 'ConversationSnapshot' })
export interface ConversationSnapshot extends Schema.Schema.Type<
  typeof ConversationSnapshot
> {}

export const RunResponse = Schema.Struct({
  status: Schema.Literals(['started', 'queued']),
  runId: Schema.String,
  baseNodeId: Schema.NullOr(Schema.String),
}).annotate({ identifier: 'RunResponse' })
export interface RunResponse extends Schema.Schema.Type<typeof RunResponse> {}

export const CompactRunResponse = Schema.Struct({
  status: Schema.Literals(['started', 'queued']),
  runId: Schema.String,
  baseNodeId: Schema.NullOr(Schema.String),
}).annotate({ identifier: 'CompactRunResponse' })
export interface CompactRunResponse extends Schema.Schema.Type<
  typeof CompactRunResponse
> {}

export const StopResponse = Schema.Struct({
  status: Schema.Literals(['stopped', 'not_running']),
  focusNodeId: Schema.optional(Schema.String),
}).annotate({ identifier: 'StopResponse' })
export interface StopResponse extends Schema.Schema.Type<typeof StopResponse> {}

export const ProjectResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  archivedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastOpenedAt: Schema.NullOr(Schema.Number),
}).annotate({ identifier: 'ProjectResponse' })
export interface ProjectResponse extends Schema.Schema.Type<
  typeof ProjectResponse
> {}

const ErrorCode = Schema.String

export class StorageUnavailable extends Schema.TaggedErrorClass<StorageUnavailable>()(
  'StorageUnavailable',
  {
    code: ErrorCode,
    operation: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {
  static fromStorage(error: StorageErrorLike) {
    return new StorageUnavailable({
      code: 'storage.unavailable',
      operation: error.operation,
      message: `${error.operation}: ${error.message}`,
      retryable: true,
    })
  }
}

export class ProjectOperationFailed extends Schema.TaggedErrorClass<ProjectOperationFailed>()(
  'ProjectOperationFailed',
  {
    code: ErrorCode,
    operation: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {
  static fromProject(error: ProjectErrorLike) {
    return new ProjectOperationFailed({
      code: 'project.operation_failed',
      operation: error.operation,
      message: `${error.operation}: ${error.message}`,
      retryable: false,
    })
  }
}

export class ProviderCredentialsUnavailable extends Schema.TaggedErrorClass<ProviderCredentialsUnavailable>()(
  'ProviderCredentialsUnavailable',
  {
    code: ErrorCode,
    operation: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class ProviderAuthUnsupported extends Schema.TaggedErrorClass<ProviderAuthUnsupported>()(
  'ProviderAuthUnsupported',
  {
    code: ErrorCode,
    provider: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class ProviderNotConfigured extends Schema.TaggedErrorClass<ProviderNotConfigured>()(
  'ProviderNotConfigured',
  {
    code: ErrorCode,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class ModelCatalogUnavailable extends Schema.TaggedErrorClass<ModelCatalogUnavailable>()(
  'ModelCatalogUnavailable',
  {
    code: ErrorCode,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class ModelUnavailable extends Schema.TaggedErrorClass<ModelUnavailable>()(
  'ModelUnavailable',
  {
    code: ErrorCode,
    model: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class RunRejected extends Schema.TaggedErrorClass<RunRejected>()(
  'RunRejected',
  {
    code: ErrorCode,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export const AuthSetResponse = Schema.Struct({
  ok: Schema.Boolean,
}).annotate({ identifier: 'AuthSetResponse' })
export interface AuthSetResponse extends Schema.Schema.Type<
  typeof AuthSetResponse
> {}

export const AuthProviderStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  authenticated: Schema.Boolean,
}).annotate({ identifier: 'AuthProviderStatus' })
export interface AuthProviderStatus extends Schema.Schema.Type<
  typeof AuthProviderStatus
> {}

export const AuthStatusResponse = Schema.Struct({
  providers: Schema.Array(AuthProviderStatus),
  hasAuthenticatedProvider: Schema.Boolean,
}).annotate({ identifier: 'AuthStatusResponse' })
export interface AuthStatusResponse extends Schema.Schema.Type<
  typeof AuthStatusResponse
> {}

export const EventsQuery = Schema.Struct({
  runId: Schema.optional(Schema.String),
  since: Schema.optional(Schema.String),
  sinceSequence: Schema.optional(Schema.Number),
}).annotate({ identifier: 'EventsQuery' })
export interface EventsQuery extends Schema.Schema.Type<typeof EventsQuery> {}

export const AuthOauthAuthorizeResponse = Schema.Struct({
  url: Schema.String,
}).annotate({ identifier: 'AuthOauthAuthorizeResponse' })
export interface AuthOauthAuthorizeResponse extends Schema.Schema.Type<
  typeof AuthOauthAuthorizeResponse
> {}

export const ModelOption = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.String,
  capabilities: Schema.Struct({
    attachment: Schema.Boolean,
    reasoning: Schema.Boolean,
    temperature: Schema.Boolean,
    toolCall: Schema.Boolean,
    thinkingLevels: Schema.Array(
      Schema.Literals([
        'off',
        'on',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ])
    ),
    modes: Schema.Array(Schema.String),
    limits: Schema.Struct({
      context: Schema.Number,
      input: Schema.optional(Schema.Number),
      output: Schema.Number,
    }),
  }),
}).annotate({ identifier: 'ModelOption' })
export interface ModelOption extends Schema.Schema.Type<typeof ModelOption> {}

export const ModelsResponse = Schema.Struct({
  models: Schema.Array(ModelOption),
  defaultModel: Schema.optional(Schema.String),
}).annotate({ identifier: 'ModelsResponse' })
export interface ModelsResponse extends Schema.Schema.Type<
  typeof ModelsResponse
> {}

export const DirectoryEntry = Schema.Struct({
  /** Entry name (e.g. "src") */
  name: Schema.String,
  /** Fully resolved absolute path */
  path: Schema.String,
  type: Schema.Literals(['directory', 'file']),
}).annotate({ identifier: 'DirectoryEntry' })
export interface DirectoryEntry extends Schema.Schema.Type<
  typeof DirectoryEntry
> {}

export const DirectoryListResponse = Schema.Struct({
  /** The resolved absolute path of the listed directory */
  resolved: Schema.String,
  /** The user's home directory (for ~ substitution in display) */
  home: Schema.String,
  entries: Schema.Array(DirectoryEntry),
}).annotate({ identifier: 'DirectoryListResponse' })
export interface DirectoryListResponse extends Schema.Schema.Type<
  typeof DirectoryListResponse
> {}

export const ProjectFileSearchResult = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  type: Schema.Literals(['directory', 'file']),
  score: Schema.optional(Schema.Number),
}).annotate({ identifier: 'ProjectFileSearchResult' })
export interface ProjectFileSearchResult extends Schema.Schema.Type<
  typeof ProjectFileSearchResult
> {}

export const ProjectFileSearchResponse = Schema.Struct({
  entries: Schema.Array(ProjectFileSearchResult),
  totalMatched: Schema.Number,
}).annotate({ identifier: 'ProjectFileSearchResponse' })
export interface ProjectFileSearchResponse extends Schema.Schema.Type<
  typeof ProjectFileSearchResponse
> {}

export const RunAttachment = Schema.Struct({
  mediaType: Schema.String,
  fileName: Schema.String,
  data: Schema.String,
  size: Schema.Number,
})
export type RunAttachment = typeof RunAttachment.Type

export class DirectoryError extends Schema.TaggedErrorClass<DirectoryError>()(
  'DirectoryError',
  { message: Schema.String }
) {}

export const ToolInfo = Schema.Struct({
  name: Schema.String,
  displayName: Schema.String,
}).annotate({ identifier: 'ToolInfo' })
export interface ToolInfo extends Schema.Schema.Type<typeof ToolInfo> {}

export const HandshakeResponse = Schema.Struct({
  /** Server version identifier */
  version: Schema.String,
  /** Server status — 'ok' if healthy */
  status: Schema.Literal('ok'),
  /** Tools available from this server runtime. */
  tools: Schema.Array(ToolInfo),
}).annotate({ identifier: 'HandshakeResponse' })
export interface HandshakeResponse extends Schema.Schema.Type<
  typeof HandshakeResponse
> {}

// ── Sessions Group ──────────────────────────────────────────────────

export class SessionsGroup extends HttpApiGroup.make('sessions')
  .add(
    HttpApiEndpoint.get('list', '/', {
      success: Schema.Array(SessionResponse),
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.post('create', '/', {
      payload: Schema.Struct({
        projectId: Schema.String,
        title: Schema.optional(Schema.String),
      }),
      success: SessionResponse,
      error: [
        StorageUnavailable.pipe(HttpApiSchema.status(503)),
        ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
      ],
    })
  )
  .add(
    HttpApiEndpoint.get('get', '/:id', {
      params: { id: SessionId },
      success: SessionResponse,
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.delete('delete', '/:id', {
      params: { id: SessionId },
      success: Schema.Void,
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.get('leaves', '/:id/leaves', {
      params: { id: SessionId },
      success: Schema.Array(MessageNodeResponse),
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.get('messages', '/:id/messages', {
      params: { id: SessionId },
      success: ConversationSnapshot,
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.post('run', '/:id/run', {
      params: { id: SessionId },
      payload: Schema.Struct({
        input: Schema.String,
        attachments: Schema.optional(Schema.Array(RunAttachment)),
        model: Schema.String,
        baseNodeId: Schema.NullOr(Schema.String),
        afterRunId: Schema.optional(Schema.NullOr(Schema.String)),
        modelOptions: Schema.optional(
          Schema.Struct({
            thinkingLevel: Schema.optional(
              Schema.Literals([
                'off',
                'on',
                'minimal',
                'low',
                'medium',
                'high',
                'xhigh',
                'max',
              ])
            ),
            mode: Schema.optional(Schema.String),
          })
        ),
      }),
      success: RunResponse,
      error: [
        StorageUnavailable.pipe(HttpApiSchema.status(503)),
        ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
        ProviderCredentialsUnavailable.pipe(HttpApiSchema.status(503)),
        ProviderNotConfigured.pipe(HttpApiSchema.status(412)),
        ModelCatalogUnavailable.pipe(HttpApiSchema.status(503)),
        ModelUnavailable.pipe(HttpApiSchema.status(422)),
        RunRejected.pipe(HttpApiSchema.status(409)),
      ],
    })
  )
  .add(
    HttpApiEndpoint.post('compactRange', '/:id/compact-range', {
      params: { id: SessionId },
      payload: Schema.Struct({
        model: Schema.String,
        baseHeadNodeId: Schema.String,
        startNodeId: Schema.String,
        endNodeId: Schema.String,
        instructions: Schema.optional(Schema.String),
      }),
      success: CompactRunResponse,
      error: [
        StorageUnavailable.pipe(HttpApiSchema.status(503)),
        ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
        ProviderCredentialsUnavailable.pipe(HttpApiSchema.status(503)),
        ProviderNotConfigured.pipe(HttpApiSchema.status(412)),
        ModelCatalogUnavailable.pipe(HttpApiSchema.status(503)),
        ModelUnavailable.pipe(HttpApiSchema.status(422)),
        RunRejected.pipe(HttpApiSchema.status(409)),
      ],
    })
  )
  .add(
    HttpApiEndpoint.post('stop', '/:id/stop', {
      params: { id: SessionId },
      success: StopResponse,
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.post('stopRun', '/runs/:id/stop', {
      params: { id: Schema.String },
      success: StopResponse,
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .prefix('/sessions') {}

// ── Projects Group ─────────────────────────────────────────────────

export class ProjectsGroup extends HttpApiGroup.make('projects')
  .add(
    HttpApiEndpoint.get('list', '/', {
      success: Schema.Array(ProjectResponse),
      error: ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.post('create', '/', {
      payload: Schema.Struct({
        path: Schema.String,
        name: Schema.optional(Schema.String),
      }),
      success: ProjectResponse,
      error: ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.get('get', '/:id', {
      params: { id: ProjectId },
      success: ProjectResponse,
      error: ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.get('searchFiles', '/:id/files', {
      params: { id: ProjectId },
      query: {
        query: Schema.String,
        limit: Schema.Number.pipe(
          Schema.withDecodingDefault(Effect.succeed(20))
        ),
      },
      success: ProjectFileSearchResponse,
      error: ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.post('archive', '/:id/archive', {
      params: { id: ProjectId },
      payload: Schema.Struct({
        archiveSessions: Schema.optional(Schema.Boolean),
      }),
      success: Schema.Void,
      error: [
        ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
        StorageUnavailable.pipe(HttpApiSchema.status(503)),
      ],
    })
  )
  .prefix('/projects') {}

// ── Directories Group ───────────────────────────────────────────────

export class DirectoriesGroup extends HttpApiGroup.make('directories')
  .add(
    HttpApiEndpoint.get('list', '/', {
      query: {
        path: Schema.String.pipe(
          Schema.withDecodingDefault(Effect.succeed('~'))
        ),
      },
      success: DirectoryListResponse,
      error: DirectoryError.pipe(HttpApiSchema.status(400)),
    })
  )
  .prefix('/directories') {}

// ── Handshake Group ─────────────────────────────────────────────────

export class HandshakeGroup extends HttpApiGroup.make('handshake')
  .add(HttpApiEndpoint.get('check', '/', { success: HandshakeResponse }))
  .prefix('/handshake') {}

// ── Events Group ─────────────────────────────────────────────────────

export class EventsGroup extends HttpApiGroup.make('events').add(
  HttpApiEndpoint.get('stream', '/events', {
    query: EventsQuery,
    success: Schema.String.pipe(
      HttpApiSchema.asText({ contentType: 'text/event-stream' })
    ),
  })
) {}

// ── Models Group ────────────────────────────────────────────────────

export class ModelsGroup extends HttpApiGroup.make('models')
  .add(
    HttpApiEndpoint.get('list', '/', {
      query: {
        projectId: Schema.String,
      },
      success: ModelsResponse,
      error: [
        ProviderCredentialsUnavailable.pipe(HttpApiSchema.status(503)),
        ProviderNotConfigured.pipe(HttpApiSchema.status(412)),
        ModelCatalogUnavailable.pipe(HttpApiSchema.status(503)),
        ProjectOperationFailed.pipe(HttpApiSchema.status(500)),
      ],
    })
  )
  .prefix('/models') {}

// ── Auth Group ──────────────────────────────────────────────────────

export class AuthGroup extends HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.get('status', '/', {
      success: AuthStatusResponse,
      error: ProviderCredentialsUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.put('set', '/:provider', {
      params: { provider: Schema.String },
      payload: Schema.Struct({ key: Schema.String }),
      success: AuthSetResponse,
      error: ProviderCredentialsUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.post('oauthAuthorize', '/:provider/oauth/authorize', {
      params: { provider: Schema.String },
      success: AuthOauthAuthorizeResponse,
      error: [
        ProviderCredentialsUnavailable.pipe(HttpApiSchema.status(503)),
        ProviderAuthUnsupported.pipe(HttpApiSchema.status(400)),
      ],
    })
  )
  .prefix('/auth') {}

// ── Root API ────────────────────────────────────────────────────────

export class Api extends HttpApi.make('sorato')
  .add(ProjectsGroup)
  .add(SessionsGroup)
  .add(DirectoriesGroup)
  .add(ModelsGroup)
  .add(AuthGroup)
  .add(HandshakeGroup)
  .add(EventsGroup) {}
