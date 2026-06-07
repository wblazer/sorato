/**
 * HTTP API definition for the Sorato server.
 *
 * Pure schema — no runtime behavior. Shared between server and (eventually)
 * a type-safe client generated via HttpApiClient.
 */
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import { Effect, Schema } from 'effect'
import { ProjectError, ProjectId } from './project/project.ts'
import { SessionId, StorageError } from './session/session.ts'

// ── Schemas ─────────────────────────────────────────────────────────

export class SessionResponse extends Schema.Class<SessionResponse>(
  'SessionResponse'
)({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.NullOr(Schema.String),
  /** Ephemeral run status — 'running' if an agent run is active. */
  status: Schema.Literals(['idle', 'running']),
  archivedAt: Schema.NullOr(Schema.Number),
  lastUserMessageAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class RunUsageResponse extends Schema.Class<RunUsageResponse>(
  'RunUsageResponse'
)({
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  reasoningTokens: Schema.NullOr(Schema.Number),
  cacheReadTokens: Schema.NullOr(Schema.Number),
  cacheWriteTokens: Schema.NullOr(Schema.Number),
  totalTokens: Schema.NullOr(Schema.Number),
  contextWindowTokens: Schema.NullOr(Schema.Number),
  actualCostMicrosUsd: Schema.NullOr(Schema.Number),
  listPriceMicrosUsd: Schema.NullOr(Schema.Number),
}) {}

export class RunSummaryResponse extends Schema.Class<RunSummaryResponse>(
  'RunSummaryResponse'
)({
  id: Schema.String,
  status: Schema.Literals(['running', 'completed', 'interrupted', 'failed']),
  providerId: Schema.String,
  modelId: Schema.String,
  billingMode: Schema.Literals(['api-key', 'subscription']),
  usage: RunUsageResponse,
  createdAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
}) {}

export class MessageNodeResponse extends Schema.Class<MessageNodeResponse>(
  'MessageNodeResponse'
)({
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
  encoded: Schema.Unknown,
  createdAt: Schema.Number,
}) {}

export class RunResponse extends Schema.Class<RunResponse>('RunResponse')({
  status: Schema.Literals(['started', 'queued']),
  runId: Schema.String,
}) {}

export class StopResponse extends Schema.Class<StopResponse>('StopResponse')({
  status: Schema.Literals(['stopped', 'not_running']),
}) {}

export class ProjectResponse extends Schema.Class<ProjectResponse>(
  'ProjectResponse'
)({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  archivedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastOpenedAt: Schema.NullOr(Schema.Number),
}) {}

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
  static fromStorage(error: StorageError) {
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
  static fromProject(error: ProjectError) {
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

export class AuthSetResponse extends Schema.Class<AuthSetResponse>(
  'AuthSetResponse'
)({
  ok: Schema.Boolean,
}) {}

export class AuthProviderStatus extends Schema.Class<AuthProviderStatus>(
  'AuthProviderStatus'
)({
  id: Schema.String,
  name: Schema.String,
  authenticated: Schema.Boolean,
}) {}

export class AuthStatusResponse extends Schema.Class<AuthStatusResponse>(
  'AuthStatusResponse'
)({
  providers: Schema.Array(AuthProviderStatus),
  hasAuthenticatedProvider: Schema.Boolean,
}) {}

export class AuthOauthAuthorizeResponse extends Schema.Class<AuthOauthAuthorizeResponse>(
  'AuthOauthAuthorizeResponse'
)({
  url: Schema.String,
}) {}

export class ModelOption extends Schema.Class<ModelOption>('ModelOption')({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.String,
  capabilities: Schema.Struct({
    attachment: Schema.Boolean,
    reasoning: Schema.Boolean,
    temperature: Schema.Boolean,
    toolCall: Schema.Boolean,
    thinkingLevels: Schema.Array(
      Schema.Literals(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    ),
    modes: Schema.Array(Schema.String),
    limits: Schema.Struct({
      context: Schema.Number,
      input: Schema.optional(Schema.Number),
      output: Schema.Number,
    }),
  }),
}) {}

export class ModelsResponse extends Schema.Class<ModelsResponse>(
  'ModelsResponse'
)({
  models: Schema.Array(ModelOption),
  defaultModel: Schema.optional(Schema.String),
}) {}

export class DirectoryEntry extends Schema.Class<DirectoryEntry>(
  'DirectoryEntry'
)({
  /** Entry name (e.g. "src") */
  name: Schema.String,
  /** Fully resolved absolute path */
  path: Schema.String,
  type: Schema.Literals(['directory', 'file']),
}) {}

export class DirectoryListResponse extends Schema.Class<DirectoryListResponse>(
  'DirectoryListResponse'
)({
  /** The resolved absolute path of the listed directory */
  resolved: Schema.String,
  /** The user's home directory (for ~ substitution in display) */
  home: Schema.String,
  entries: Schema.Array(DirectoryEntry),
}) {}

export class DirectoryError extends Schema.TaggedErrorClass<DirectoryError>()(
  'DirectoryError',
  { message: Schema.String }
) {}

export class HandshakeResponse extends Schema.Class<HandshakeResponse>(
  'HandshakeResponse'
)({
  /** Server version identifier */
  version: Schema.String,
  /** Server status — 'ok' if healthy */
  status: Schema.Literal('ok'),
}) {}

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
      success: Schema.Array(MessageNodeResponse),
      error: StorageUnavailable.pipe(HttpApiSchema.status(503)),
    })
  )
  .add(
    HttpApiEndpoint.post('run', '/:id/run', {
      params: { id: SessionId },
      payload: Schema.Struct({
        input: Schema.String,
        model: Schema.String,
        baseNodeId: Schema.NullOr(Schema.String),
        afterRunId: Schema.optional(Schema.NullOr(Schema.String)),
        modelOptions: Schema.optional(
          Schema.Struct({
            thinkingLevel: Schema.optional(
              Schema.Literals([
                'off',
                'minimal',
                'low',
                'medium',
                'high',
                'xhigh',
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
    HttpApiEndpoint.post('stop', '/:id/stop', {
      params: { id: SessionId },
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
  .add(HandshakeGroup) {}
