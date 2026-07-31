import { BrowserHttpClient } from '@effect/platform-browser'
import {
  Api,
  CompactRunResponse,
  ConversationSnapshot,
  DevScenarioId,
  DevScenariosStatus,
  ModelOption,
  ProjectResponse,
  RunResponse,
  SessionResponse,
  StopResponse,
} from '@sorato/api'
import { Cause, Effect, Schema } from 'effect'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { Command } from 'foldkit'
import { m } from 'foldkit/message'

export const LoadedWorkspace = m('LoadedWorkspace', {
  baseUrl: Schema.String,
  projects: Schema.Array(ProjectResponse),
  sessions: Schema.Array(SessionResponse),
})
export const FailedRequest = m('FailedRequest', {
  baseUrl: Schema.String,
  operation: Schema.String,
  error: Schema.String,
})
export const LoadedModels = m('LoadedModels', {
  baseUrl: Schema.String,
  projectId: Schema.String,
  models: Schema.Array(ModelOption),
  defaultModel: Schema.optional(Schema.String),
})
export const LoadedTranscript = m('LoadedTranscript', {
  baseUrl: Schema.String,
  sessionId: Schema.String,
  snapshot: ConversationSnapshot,
})
export const CreatedSession = m('CreatedSession', {
  baseUrl: Schema.String,
  session: SessionResponse,
})
export const StartedRun = m('StartedRun', {
  baseUrl: Schema.String,
  sessionId: Schema.String,
  run: RunResponse,
})
export const StartedNewSession = m('StartedNewSession', {
  baseUrl: Schema.String,
  session: SessionResponse,
  run: RunResponse,
})
export const StoppedRun = m('StoppedRun', {
  baseUrl: Schema.String,
  runId: Schema.String,
  status: StopResponse,
})
export const LoadedDevScenarios = m('LoadedDevScenarios', {
  baseUrl: Schema.String,
  status: DevScenariosStatus,
})
export const DevScenariosUnavailable = m('DevScenariosUnavailable', {
  baseUrl: Schema.String,
})
export const StartedCompaction = m('StartedCompaction', {
  baseUrl: Schema.String,
  sessionId: Schema.String,
  run: CompactRunResponse,
})

const client = (baseUrl: string) =>
  HttpApiClient.make(Api, { baseUrl }).pipe(
    Effect.provide(BrowserHttpClient.layerFetch)
  )

const failed =
  (baseUrl: string, operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.catchCause(effect, (cause) =>
      Effect.succeed(
        FailedRequest({ baseUrl, operation, error: Cause.pretty(cause) })
      )
    )

export const LoadWorkspace = Command.define('LoadWorkspace', {
  args: { baseUrl: Schema.String },
  messages: [LoadedWorkspace, FailedRequest],
  execute: ({ baseUrl }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const [projects, sessions] = yield* Effect.all([
        api.projects.list(),
        api.sessions.list(),
      ])
      return LoadedWorkspace({ baseUrl, projects, sessions })
    }).pipe(failed(baseUrl, 'load workspace')),
})

export const LoadDevScenarios = Command.define('LoadDevScenarios', {
  args: { baseUrl: Schema.String },
  messages: [LoadedDevScenarios, DevScenariosUnavailable],
  execute: ({ baseUrl }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const status = yield* api.devScenarios.status()
      return LoadedDevScenarios({ baseUrl, status })
    }).pipe(
      Effect.catch(() => Effect.succeed(DevScenariosUnavailable({ baseUrl })))
    ),
})

export const ActivateDevScenario = Command.define('ActivateDevScenario', {
  args: { baseUrl: Schema.String, scenario: DevScenarioId },
  messages: [LoadedDevScenarios, DevScenariosUnavailable],
  execute: ({ baseUrl, scenario }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const status = yield* api.devScenarios.activate({
        params: { scenario },
      })
      return LoadedDevScenarios({ baseUrl, status })
    }).pipe(
      Effect.catch(() => Effect.succeed(DevScenariosUnavailable({ baseUrl })))
    ),
})

export const DeactivateDevScenario = Command.define('DeactivateDevScenario', {
  args: { baseUrl: Schema.String },
  messages: [LoadedDevScenarios, DevScenariosUnavailable],
  execute: ({ baseUrl }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const status = yield* api.devScenarios.deactivate()
      return LoadedDevScenarios({ baseUrl, status })
    }).pipe(
      Effect.catch(() => Effect.succeed(DevScenariosUnavailable({ baseUrl })))
    ),
})

export const LoadModels = Command.define('LoadModels', {
  args: { baseUrl: Schema.String, projectId: Schema.String },
  messages: [LoadedModels, FailedRequest],
  execute: ({ baseUrl, projectId }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const response = yield* api.models.list({ query: { projectId } })
      return LoadedModels({ baseUrl, projectId, ...response })
    }).pipe(failed(baseUrl, 'load models')),
})

export const LoadTranscript = Command.define('LoadTranscript', {
  args: { baseUrl: Schema.String, sessionId: Schema.String },
  messages: [LoadedTranscript, FailedRequest],
  execute: ({ baseUrl, sessionId }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const snapshot = yield* api.sessions.messages({
        params: { id: sessionId },
      })
      return LoadedTranscript({ baseUrl, sessionId, snapshot })
    }).pipe(failed(baseUrl, 'load transcript')),
})

export const CreateSession = Command.define('CreateSession', {
  args: { baseUrl: Schema.String, projectId: Schema.String },
  messages: [CreatedSession, FailedRequest],
  execute: ({ baseUrl, projectId }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const session = yield* api.sessions.create({ payload: { projectId } })
      return CreatedSession({ baseUrl, session })
    }).pipe(failed(baseUrl, 'create session')),
})

export const CreateSessionAndStartRun = Command.define(
  'CreateSessionAndStartRun',
  {
    args: {
      baseUrl: Schema.String,
      projectId: Schema.String,
      input: Schema.String,
      model: Schema.String,
    },
    messages: [StartedNewSession, FailedRequest],
    execute: ({ baseUrl, projectId, input, model }) =>
      Effect.gen(function* () {
        const api = yield* client(baseUrl)
        const session = yield* api.sessions.create({ payload: { projectId } })
        const run = yield* api.sessions.run({
          params: { id: session.id },
          payload: { input, model, baseNodeId: null },
        })
        return StartedNewSession({ baseUrl, session, run })
      }).pipe(failed(baseUrl, 'create session and start run')),
  }
)

export const StartRun = Command.define('StartRun', {
  args: {
    baseUrl: Schema.String,
    sessionId: Schema.String,
    input: Schema.String,
    model: Schema.String,
    baseNodeId: Schema.NullOr(Schema.String),
  },
  messages: [StartedRun, FailedRequest],
  execute: ({ baseUrl, sessionId, input, model, baseNodeId }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const run = yield* api.sessions.run({
        params: { id: sessionId },
        payload: { input, model, baseNodeId },
      })
      return StartedRun({ baseUrl, sessionId, run })
    }).pipe(failed(baseUrl, 'start run')),
})

export const StopRun = Command.define('StopRun', {
  args: { baseUrl: Schema.String, runId: Schema.String },
  messages: [StoppedRun, FailedRequest],
  execute: ({ baseUrl, runId }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const status = yield* api.sessions.stopRun({ params: { id: runId } })
      return StoppedRun({ baseUrl, runId, status })
    }).pipe(failed(baseUrl, 'stop run')),
})

export const CompactRange = Command.define('CompactRange', {
  args: {
    baseUrl: Schema.String,
    sessionId: Schema.String,
    model: Schema.String,
    baseHeadNodeId: Schema.String,
    startNodeId: Schema.String,
    endNodeId: Schema.String,
  },
  messages: [StartedCompaction, FailedRequest],
  execute: ({
    baseUrl,
    sessionId,
    model,
    baseHeadNodeId,
    startNodeId,
    endNodeId,
  }) =>
    Effect.gen(function* () {
      const api = yield* client(baseUrl)
      const run = yield* api.sessions.compactRange({
        params: { id: sessionId },
        payload: { model, baseHeadNodeId, startNodeId, endNodeId },
      })
      return StartedCompaction({ baseUrl, sessionId, run })
    }).pipe(failed(baseUrl, 'compact range')),
})
