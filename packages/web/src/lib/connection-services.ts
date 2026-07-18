import type {
  AuthOauthAuthorizeResponse,
  AuthSetResponse,
  AuthStatusResponse,
  CompactRunResponse,
  ConversationSnapshot,
  DirectoryListResponse,
  HandshakeResponse,
  ModelsResponse,
  RunResponse,
  SessionResponse,
  StopResponse,
} from '@sorato/api'
import { Context, Effect, Stream } from 'effect'
import type { UiApiError } from '$lib/api-errors.js'
import type {
  MessageNode,
  ModelOptions,
  Project,
  RunAttachment,
  ServerEvent,
  ToolResultDisplay,
} from '$lib/types.js'
import type { ServerEventStreamOptions, SseError } from '$lib/sse.js'

export interface ActiveConnectionInfo {
  readonly id: string
  readonly scopeId: string
  readonly baseUrl: string
}

export class ActiveConnection extends Context.Service<
  ActiveConnection,
  ActiveConnectionInfo
>()('@sorato/web/ActiveConnection') {}

export interface CreateSessionInput {
  readonly projectId: string
}

export interface RunAgentInput {
  readonly sessionId: string
  readonly input: string
  readonly attachments: ReadonlyArray<RunAttachment>
  readonly model: string
  readonly baseNodeId: string | null
  readonly afterRunId: string | null
  readonly modelOptions: ModelOptions
}

export interface CompactRangeInput {
  readonly sessionId: string
  readonly model: string
  readonly baseHeadNodeId: string
  readonly startNodeId: string
  readonly endNodeId: string
  readonly instructions?: string
}

export interface SessionsApiShape {
  readonly list: () => Effect.Effect<ReadonlyArray<SessionResponse>, UiApiError>
  readonly get: (
    sessionId: string
  ) => Effect.Effect<SessionResponse, UiApiError>
  readonly create: (
    input: CreateSessionInput
  ) => Effect.Effect<SessionResponse, UiApiError>
  readonly run: (input: RunAgentInput) => Effect.Effect<RunResponse, UiApiError>
  readonly compactRange: (
    input: CompactRangeInput
  ) => Effect.Effect<CompactRunResponse, UiApiError>
  readonly stopRun: (runId: string) => Effect.Effect<StopResponse, UiApiError>
}

export class SessionsApi extends Context.Service<
  SessionsApi,
  SessionsApiShape
>()('@sorato/web/SessionsApi') {}

export interface MessagesApiShape {
  readonly list: (
    sessionId: string
  ) => Effect.Effect<ConversationSnapshot, UiApiError>
}

export class MessagesApi extends Context.Service<
  MessagesApi,
  MessagesApiShape
>()('@sorato/web/MessagesApi') {}

export interface ProjectsApiShape {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>, UiApiError>
  readonly create: (path: string) => Effect.Effect<Project, UiApiError>
  readonly archive: (
    projectId: string,
    archiveSessions: boolean
  ) => Effect.Effect<void, UiApiError>
  readonly searchFiles: (
    projectId: string,
    query: string,
    limit: number
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly path: string
      readonly name: string
      readonly type: 'directory' | 'file'
      readonly score?: number
    }>,
    UiApiError
  >
}

export class ProjectsApi extends Context.Service<
  ProjectsApi,
  ProjectsApiShape
>()('@sorato/web/ProjectsApi') {}

export interface ModelsApiShape {
  readonly list: (
    projectId: string
  ) => Effect.Effect<ModelsResponse, UiApiError>
}

export class ModelsApi extends Context.Service<ModelsApi, ModelsApiShape>()(
  '@sorato/web/ModelsApi'
) {}

export interface AuthApiShape {
  readonly status: () => Effect.Effect<AuthStatusResponse, UiApiError>
  readonly set: (
    providerId: string,
    key: string
  ) => Effect.Effect<AuthSetResponse, UiApiError>
  readonly oauthAuthorize: (
    providerId: string
  ) => Effect.Effect<AuthOauthAuthorizeResponse, UiApiError>
}

export class AuthApi extends Context.Service<AuthApi, AuthApiShape>()(
  '@sorato/web/AuthApi'
) {}

export interface DirectoriesApiShape {
  readonly list: (
    path: string
  ) => Effect.Effect<DirectoryListResponse, UiApiError>
}

export class DirectoriesApi extends Context.Service<
  DirectoriesApi,
  DirectoriesApiShape
>()('@sorato/web/DirectoriesApi') {}

export interface HandshakeApiShape {
  readonly check: () => Effect.Effect<HandshakeResponse, UiApiError>
}

export class HandshakeApi extends Context.Service<
  HandshakeApi,
  HandshakeApiShape
>()('@sorato/web/HandshakeApi') {}

export interface ServerEventSourceShape {
  readonly stream: (
    options?: ServerEventStreamOptions
  ) => Stream.Stream<ServerEvent, SseError>
}

export class ServerEventSource extends Context.Service<
  ServerEventSource,
  ServerEventSourceShape
>()('@sorato/web/ServerEventSource') {}

export interface MessageToolPreloaderShape {
  readonly preloadMessages: (
    messages: ReadonlyArray<MessageNode>
  ) => Effect.Effect<void>
  readonly preloadTool: (
    display: ToolResultDisplay,
    cacheKey: string
  ) => Effect.Effect<void>
}

export class MessageToolPreloader extends Context.Service<
  MessageToolPreloader,
  MessageToolPreloaderShape
>()('@sorato/web/MessageToolPreloader') {}

export type ConnectionServices =
  | ActiveConnection
  | SessionsApi
  | MessagesApi
  | ProjectsApi
  | ModelsApi
  | AuthApi
  | DirectoriesApi
  | HandshakeApi
  | ServerEventSource
  | MessageToolPreloader
