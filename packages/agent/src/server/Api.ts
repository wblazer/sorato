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
} from '@effect/platform'
import { Schema } from 'effect'
import { SessionId, StorageError } from '../session/session.ts'

// ── Schemas ─────────────────────────────────────────────────────────

export class SessionResponse extends Schema.Class<SessionResponse>(
  'SessionResponse'
)({
  id: Schema.String,
  directory: Schema.String,
  title: Schema.NullOr(Schema.String),
  headId: Schema.NullOr(Schema.String),
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

export class DirectoryEntry extends Schema.Class<DirectoryEntry>(
  'DirectoryEntry'
)({
  /** Entry name (e.g. "src") */
  name: Schema.String,
  /** Fully resolved absolute path */
  path: Schema.String,
  type: Schema.Literal('directory', 'file'),
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

export class DirectoryError extends Schema.TaggedError<DirectoryError>()(
  'DirectoryError',
  { message: Schema.String }
) {}

// ── Sessions Group ──────────────────────────────────────────────────

const idParam = HttpApiSchema.param('id', SessionId)

export class SessionsGroup extends HttpApiGroup.make('sessions')
  .add(
    HttpApiEndpoint.get('list', '/')
      .addSuccess(Schema.Array(SessionResponse))
      .addError(StorageError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(
        Schema.Struct({
          directory: Schema.String,
          title: Schema.optional(Schema.String),
        })
      )
      .addSuccess(SessionResponse)
      .addError(StorageError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.get('get')`/${idParam}`
      .addSuccess(SessionResponse)
      .addError(StorageError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.del('delete')`/${idParam}`
      .addSuccess(Schema.Void)
      .addError(StorageError, { status: 500 })
  )
  .add(
    HttpApiEndpoint.get('leaves')`/${idParam}/leaves`
      .addSuccess(Schema.Array(MessageNodeResponse))
      .addError(StorageError, { status: 500 })
  )
  .prefix('/sessions') {}

// ── Directories Group ───────────────────────────────────────────────

export class DirectoriesGroup extends HttpApiGroup.make('directories')
  .add(
    HttpApiEndpoint.get('list', '/')
      .setUrlParams(
        Schema.Struct({
          /** Path to list — supports ~, absolute, and relative paths.
           *  Server resolves ~ to home dir. Empty/missing = home dir. */
          path: Schema.optionalWith(Schema.String, { default: () => '~' }),
        })
      )
      .addSuccess(DirectoryListResponse)
      .addError(DirectoryError, { status: 400 })
  )
  .prefix('/directories') {}

// ── Root API ────────────────────────────────────────────────────────

export class Api extends HttpApi.make('agents')
  .add(SessionsGroup)
  .add(DirectoriesGroup) {}
