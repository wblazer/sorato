import { Effect, Layer } from 'effect'
import { runApiEffect, SoratoApiClient } from '$lib/api-client.js'
import {
  AuthApi,
  DirectoriesApi,
  HandshakeApi,
  MessageToolPreloader,
  MessagesApi,
  ModelsApi,
  ProjectsApi,
  ServerEventSource,
  SessionsApi,
} from '$lib/connection-services.js'
import { serverEvents } from '$lib/sse.js'
import { preloadMessageToolDiffs, preloadToolDiff } from '$lib/tool-output.js'

export const SessionsApiLive = Layer.effect(
  SessionsApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return SessionsApi.of({
      list: () =>
        runApiEffect(client.sessions.list(), 'Failed to load sessions'),
      get: (sessionId) =>
        runApiEffect(
          client.sessions.get({ params: { id: sessionId } }),
          'Failed to refresh session'
        ),
      create: ({ projectId }) =>
        runApiEffect(
          client.sessions.create({ payload: { projectId } }),
          'Failed to create session'
        ),
      run: ({
        sessionId,
        input,
        attachments,
        model,
        baseNodeId,
        afterRunId,
        modelOptions,
      }) =>
        runApiEffect(
          client.sessions.run({
            params: { id: sessionId },
            payload: {
              input,
              attachments,
              model,
              baseNodeId,
              afterRunId,
              modelOptions,
            },
          }),
          'Failed to start agent run'
        ),
      compactRange: ({
        sessionId,
        model,
        baseHeadNodeId,
        startNodeId,
        endNodeId,
        instructions,
      }) =>
        runApiEffect(
          client.sessions.compactRange({
            params: { id: sessionId },
            payload: {
              model,
              baseHeadNodeId,
              startNodeId,
              endNodeId,
              instructions,
            },
          }),
          'Failed to start summarization'
        ),
      stopRun: (runId) =>
        runApiEffect(
          client.sessions.stopRun({ params: { id: runId } }),
          'Failed to stop agent run'
        ),
    })
  })
)

export const MessagesApiLive = Layer.effect(
  MessagesApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return MessagesApi.of({
      list: (sessionId) =>
        runApiEffect(
          client.sessions.messages({ params: { id: sessionId } }),
          'Failed to load messages'
        ),
    })
  })
)

export const ProjectsApiLive = Layer.effect(
  ProjectsApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return ProjectsApi.of({
      list: () =>
        runApiEffect(client.projects.list(), 'Failed to load projects'),
      create: (path) =>
        runApiEffect(
          client.projects.create({ payload: { path } }),
          'Failed to create project'
        ),
      archive: (projectId, archiveSessions) =>
        runApiEffect(
          client.projects.archive({
            params: { id: projectId },
            payload: { archiveSessions },
          }),
          'Failed to archive project'
        ),
      searchFiles: (projectId, query, limit) =>
        runApiEffect(
          client.projects.searchFiles({
            params: { id: projectId },
            query: { query, limit },
          }),
          'Failed to search files'
        ).pipe(Effect.map((response) => response.entries)),
    })
  })
)

export const ModelsApiLive = Layer.effect(
  ModelsApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return ModelsApi.of({
      list: (projectId) =>
        runApiEffect(
          client.models.list({ query: { projectId } }),
          'Failed to load models'
        ),
    })
  })
)

export const AuthApiLive = Layer.effect(
  AuthApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return AuthApi.of({
      status: () =>
        runApiEffect(
          client.auth.status(),
          'Failed to check provider credentials'
        ),
      set: (providerId, key) =>
        runApiEffect(
          client.auth.set({
            params: { provider: providerId },
            payload: { key },
          }),
          'Failed to connect provider'
        ),
      oauthAuthorize: (providerId) =>
        runApiEffect(
          client.auth.oauthAuthorize({ params: { provider: providerId } }),
          'Failed to start provider sign-in'
        ),
    })
  })
)

export const DirectoriesApiLive = Layer.effect(
  DirectoriesApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return DirectoriesApi.of({
      list: (path) =>
        runApiEffect(
          client.directories.list({ query: { path } }),
          'Failed to list directories'
        ),
    })
  })
)

export const HandshakeApiLive = Layer.effect(
  HandshakeApi,
  Effect.gen(function* () {
    const client = yield* SoratoApiClient
    return HandshakeApi.of({
      check: () => runApiEffect(client.handshake.check(), 'Handshake failed'),
    })
  })
)

export const makeServerEventSourceLayer = (baseUrl: string) =>
  Layer.succeed(
    ServerEventSource,
    ServerEventSource.of({
      stream: (options) => serverEvents(baseUrl, options),
    })
  )

export const MessageToolPreloaderLive = Layer.succeed(
  MessageToolPreloader,
  MessageToolPreloader.of({
    preloadMessages: (messages) =>
      Effect.promise(() => preloadMessageToolDiffs(messages)),
    preloadTool: (display, cacheKey) =>
      Effect.promise(() => preloadToolDiff(display, cacheKey)),
  })
)

export const ApiServicesLive = Layer.mergeAll(
  SessionsApiLive,
  MessagesApiLive,
  ProjectsApiLive,
  ModelsApiLive,
  AuthApiLive,
  DirectoriesApiLive,
  HandshakeApiLive
)
