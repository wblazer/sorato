/**
 * HTTP API definition for the agents server.
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
import { Schema } from 'effect'
import { SessionId, StorageError } from '../session/session.ts'

// ── Schemas ─────────────────────────────────────────────────────────

export class SessionResponse extends Schema.Class<SessionResponse>(
  'SessionResponse'
)({
  id: Schema.String,
  directory: Schema.String,
  model: Schema.String,
  title: Schema.NullOr(Schema.String),
  headId: Schema.NullOr(Schema.String),
  /** Ephemeral run status — 'running' if an agent run is active. */
  status: Schema.Literals(['idle', 'running']),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class MessageNodeResponse extends Schema.Class<MessageNodeResponse>(
  'MessageNodeResponse'
)({
  id: Schema.String,
  sessionId: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  encoded: Schema.Unknown,
  createdAt: Schema.Number,
}) {}

export class RunResponse extends Schema.Class<RunResponse>('RunResponse')({
  status: Schema.Literals(['started', 'queued']),
}) {}

export class StopResponse extends Schema.Class<StopResponse>('StopResponse')({
  status: Schema.Literals(['stopped', 'not_running']),
}) {}

export class RunError extends Schema.TaggedErrorClass<RunError>()('RunError', {
  message: Schema.String,
}) {}

export class ModelError extends Schema.TaggedErrorClass<ModelError>()(
  'ModelError',
  {
    message: Schema.String,
  }
) {}

export class ModelOption extends Schema.Class<ModelOption>('ModelOption')({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.String,
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
      error: StorageError.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.post('create', '/', {
      payload: Schema.Struct({
        directory: Schema.String,
        model: Schema.String,
        title: Schema.optional(Schema.String),
      }),
      success: SessionResponse,
      error: [
        StorageError.pipe(HttpApiSchema.status(500)),
        ModelError.pipe(HttpApiSchema.status(500)),
      ],
    })
  )
  .add(
    HttpApiEndpoint.get('get', '/:id', {
      params: { id: SessionId },
      success: SessionResponse,
      error: StorageError.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.delete('delete', '/:id', {
      params: { id: SessionId },
      success: Schema.Void,
      error: StorageError.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.get('leaves', '/:id/leaves', {
      params: { id: SessionId },
      success: Schema.Array(MessageNodeResponse),
      error: StorageError.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.get('messages', '/:id/messages', {
      params: { id: SessionId },
      success: Schema.Array(MessageNodeResponse),
      error: StorageError.pipe(HttpApiSchema.status(500)),
    })
  )
  .add(
    HttpApiEndpoint.post('setModel', '/:id/model', {
      params: { id: SessionId },
      payload: Schema.Struct({ model: Schema.String }),
      success: SessionResponse,
      error: [
        StorageError.pipe(HttpApiSchema.status(500)),
        ModelError.pipe(HttpApiSchema.status(500)),
      ],
    })
  )
  .add(
    HttpApiEndpoint.post('run', '/:id/run', {
      params: { id: SessionId },
      payload: Schema.Struct({ input: Schema.String }),
      success: RunResponse,
      error: [
        StorageError.pipe(HttpApiSchema.status(500)),
        RunError.pipe(HttpApiSchema.status(500)),
      ],
    })
  )
  .add(
    HttpApiEndpoint.post('stop', '/:id/stop', {
      params: { id: SessionId },
      success: StopResponse,
      error: StorageError.pipe(HttpApiSchema.status(500)),
    })
  )
  .prefix('/sessions') {}

// ── Directories Group ───────────────────────────────────────────────

export class DirectoriesGroup extends HttpApiGroup.make('directories')
  .add(
    HttpApiEndpoint.get('list', '/', {
      query: {
        path: Schema.String.pipe(Schema.withDecodingDefault(() => '~')),
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
        directory: Schema.String,
      },
      success: ModelsResponse,
      error: ModelError.pipe(HttpApiSchema.status(500)),
    })
  )
  .prefix('/models') {}

// ── Root API ────────────────────────────────────────────────────────

export class Api extends HttpApi.make('agents')
  .add(SessionsGroup)
  .add(DirectoriesGroup)
  .add(ModelsGroup)
  .add(HandshakeGroup) {}
