import {
  DevScenarioId,
  DevScenariosStatus,
  MessageNodeResponse,
  ModelOption,
  ProjectResponse,
  ServerEvent,
  SessionResponse,
} from '@sorato/api'
import { Match as M, Schema } from 'effect'
import { Command, Runtime } from 'foldkit'
import { m } from 'foldkit/message'
import {
  ActivateDevScenario,
  CompactRange,
  CreateSession,
  CreatedSession,
  DeactivateDevScenario,
  DevScenariosUnavailable,
  FailedRequest,
  LoadDevScenarios,
  LoadModels,
  LoadTranscript,
  LoadWorkspace,
  LoadedModels,
  LoadedDevScenarios,
  LoadedTranscript,
  LoadedWorkspace,
  StartRun,
  StartedCompaction,
  StartedRun,
  StopRun,
  StoppedRun,
} from './api.ts'
import {
  ReceivedServerEvent,
  applyContentEvent,
  subscriptions,
} from './events.ts'
import { view } from './view.ts'

const StreamActivity = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['text', 'reasoning', 'tool-call', 'tool-result']),
  title: Schema.String,
  body: Schema.String,
  failed: Schema.Boolean,
})

export const Model = Schema.Struct({
  baseUrl: Schema.String,
  serverUrlInput: Schema.String,
  status: Schema.Literals(['loading', 'ready', 'error']),
  projects: Schema.Array(ProjectResponse),
  sessions: Schema.Array(SessionResponse),
  models: Schema.Array(ModelOption),
  nodes: Schema.Array(MessageNodeResponse),
  activity: Schema.Array(StreamActivity),
  selectedProjectId: Schema.NullOr(Schema.String),
  selectedSessionId: Schema.NullOr(Schema.String),
  selectedModelId: Schema.String,
  selectedBaseNodeId: Schema.NullOr(Schema.String),
  draft: Schema.String,
  projectFilter: Schema.String,
  activeRunId: Schema.NullOr(Schema.String),
  compactingRunId: Schema.NullOr(Schema.String),
  startingSessionId: Schema.NullOr(Schema.String),
  devScenarios: Schema.NullOr(DevScenariosStatus),
  scenarioBusy: Schema.Boolean,
  compactStartNodeId: Schema.NullOr(Schema.String),
  compactEndNodeId: Schema.NullOr(Schema.String),
  sequence: Schema.Number,
  error: Schema.NullOr(Schema.String),
})
export type Model = typeof Model.Type

export const ChangedServerUrl = m('ChangedServerUrl', { value: Schema.String })
export const ClickedConnect = m('ClickedConnect')
export const ChangedProjectFilter = m('ChangedProjectFilter', {
  value: Schema.String,
})
export const SelectedProject = m('SelectedProject', { id: Schema.String })
export const ClickedCreateSession = m('ClickedCreateSession')
export const SelectedSession = m('SelectedSession', { id: Schema.String })
export const SelectedModel = m('SelectedModel', { id: Schema.String })
export const SelectedBaseNode = m('SelectedBaseNode', { id: Schema.String })
export const ChangedDraft = m('ChangedDraft', { value: Schema.String })
export const ClickedSend = m('ClickedSend')
export const ClickedStop = m('ClickedStop')
export const SelectedDevScenario = m('SelectedDevScenario', {
  id: Schema.NullOr(DevScenarioId),
})
export const ClickedRunScenario = m('ClickedRunScenario')
export const SelectedCompactStart = m('SelectedCompactStart', {
  id: Schema.String,
})
export const SelectedCompactEnd = m('SelectedCompactEnd', {
  id: Schema.String,
})
export const ClickedCompact = m('ClickedCompact')
export const ClearedError = m('ClearedError')

export const Message = Schema.Union([
  ChangedServerUrl,
  ClickedConnect,
  ChangedProjectFilter,
  SelectedProject,
  ClickedCreateSession,
  SelectedSession,
  SelectedModel,
  SelectedBaseNode,
  ChangedDraft,
  ClickedSend,
  ClickedStop,
  SelectedDevScenario,
  ClickedRunScenario,
  SelectedCompactStart,
  SelectedCompactEnd,
  ClickedCompact,
  ClearedError,
  LoadedWorkspace,
  LoadedModels,
  LoadedTranscript,
  CreatedSession,
  StartedRun,
  StoppedRun,
  LoadedDevScenarios,
  DevScenariosUnavailable,
  StartedCompaction,
  FailedRequest,
  ReceivedServerEvent,
])
export type Message = typeof Message.Type

export const initialModel: Model = Model.make({
  baseUrl: 'http://127.0.0.1:3100',
  serverUrlInput: 'http://127.0.0.1:3100',
  status: 'loading',
  projects: [],
  sessions: [],
  models: [],
  nodes: [],
  activity: [],
  selectedProjectId: null,
  selectedSessionId: null,
  selectedModelId: '',
  selectedBaseNodeId: null,
  draft: '',
  projectFilter: '',
  activeRunId: null,
  compactingRunId: null,
  startingSessionId: null,
  devScenarios: null,
  scenarioBusy: false,
  compactStartNodeId: null,
  compactEndNodeId: null,
  sequence: 0,
  error: null,
})

export const init: Runtime.ApplicationInit<Model, Message> = () => [
  initialModel,
  [
    LoadWorkspace({ baseUrl: initialModel.baseUrl }),
    LoadDevScenarios({ baseUrl: initialModel.baseUrl }),
  ],
]

type UpdateResult = readonly [Model, ReadonlyArray<Command.Command<Message>>]
const noCommand = (model: Model): UpdateResult => [model, []]

export const update = (model: Model, message: Message): UpdateResult =>
  M.value(message).pipe(
    M.withReturnType<UpdateResult>(),
    M.tagsExhaustive({
      ChangedServerUrl: ({ value }) =>
        noCommand({ ...model, serverUrlInput: value }),
      ClickedConnect: () => {
        const baseUrl = model.serverUrlInput.trim()
        if (baseUrl.length === 0) return noCommand(model)
        return [
          {
            ...model,
            baseUrl,
            status: 'loading',
            projects: [],
            sessions: [],
            models: [],
            nodes: [],
            activity: [],
            selectedProjectId: null,
            selectedSessionId: null,
            selectedModelId: '',
            selectedBaseNodeId: null,
            activeRunId: null,
            compactingRunId: null,
            startingSessionId: null,
            devScenarios: null,
            scenarioBusy: false,
            compactStartNodeId: null,
            compactEndNodeId: null,
            sequence: 0,
            error: null,
          },
          [LoadWorkspace({ baseUrl }), LoadDevScenarios({ baseUrl })],
        ]
      },
      ChangedProjectFilter: ({ value }) =>
        noCommand({ ...model, projectFilter: value }),
      SelectedProject: ({ id }) => [
        {
          ...model,
          selectedProjectId: id,
          selectedSessionId: null,
          nodes: [],
          activity: [],
        },
        [LoadModels({ baseUrl: model.baseUrl, projectId: id })],
      ],
      ClickedCreateSession: () =>
        model.selectedProjectId === null
          ? noCommand(model)
          : [
              model,
              [
                CreateSession({
                  baseUrl: model.baseUrl,
                  projectId: model.selectedProjectId,
                }),
              ],
            ],
      SelectedSession: ({ id }) => {
        const session = model.sessions.find((candidate) => candidate.id === id)
        const activeRunId =
          session?.activeRuns?.find((run) => run.visibility === 'primary')
            ?.runId ?? null
        return [
          {
            ...model,
            selectedSessionId: id,
            nodes: [],
            activity: [],
            selectedBaseNodeId: null,
            activeRunId,
            startingSessionId: null,
          },
          [LoadTranscript({ baseUrl: model.baseUrl, sessionId: id })],
        ]
      },
      SelectedModel: ({ id }) => noCommand({ ...model, selectedModelId: id }),
      SelectedBaseNode: ({ id }) =>
        noCommand({ ...model, selectedBaseNodeId: id }),
      ChangedDraft: ({ value }) => noCommand({ ...model, draft: value }),
      ClickedSend: () =>
        model.selectedSessionId === null ||
        model.selectedModelId === '' ||
        model.draft.trim() === '' ||
        model.activeRunId !== null ||
        model.startingSessionId !== null
          ? noCommand(model)
          : [
              {
                ...model,
                draft: '',
                error: null,
                startingSessionId: model.selectedSessionId,
              },
              [
                StartRun({
                  baseUrl: model.baseUrl,
                  sessionId: model.selectedSessionId,
                  input: model.draft.trim(),
                  model: model.selectedModelId,
                  baseNodeId: model.selectedBaseNodeId,
                }),
              ],
            ],
      ClickedStop: () =>
        model.activeRunId === null
          ? noCommand(model)
          : [
              model,
              [StopRun({ baseUrl: model.baseUrl, runId: model.activeRunId })],
            ],
      SelectedDevScenario: ({ id }) => [
        { ...model, scenarioBusy: true },
        [
          id === null
            ? DeactivateDevScenario({ baseUrl: model.baseUrl })
            : ActivateDevScenario({ baseUrl: model.baseUrl, scenario: id }),
        ],
      ],
      ClickedRunScenario: () =>
        model.selectedSessionId === null ||
        model.devScenarios === null ||
        model.devScenarios.activeScenario === null ||
        model.activeRunId !== null ||
        model.startingSessionId !== null
          ? noCommand(model)
          : [
              {
                ...model,
                error: null,
                startingSessionId: model.selectedSessionId,
              },
              [
                StartRun({
                  baseUrl: model.baseUrl,
                  sessionId: model.selectedSessionId,
                  input: `Exercise the ${model.devScenarios.activeScenario} development scenario.`,
                  model: 'mock/streaming-demo',
                  baseNodeId: model.selectedBaseNodeId,
                }),
              ],
            ],
      SelectedCompactStart: ({ id }) =>
        noCommand({ ...model, compactStartNodeId: id }),
      SelectedCompactEnd: ({ id }) =>
        noCommand({ ...model, compactEndNodeId: id }),
      ClickedCompact: () =>
        model.selectedSessionId === null ||
        model.selectedModelId === '' ||
        model.selectedBaseNodeId === null ||
        model.compactStartNodeId === null ||
        model.compactEndNodeId === null ||
        model.compactingRunId !== null
          ? noCommand(model)
          : [
              model,
              [
                CompactRange({
                  baseUrl: model.baseUrl,
                  sessionId: model.selectedSessionId,
                  model: model.selectedModelId,
                  baseHeadNodeId: model.selectedBaseNodeId,
                  startNodeId: model.compactStartNodeId,
                  endNodeId: model.compactEndNodeId,
                }),
              ],
            ],
      ClearedError: () => noCommand({ ...model, error: null }),
      LoadedWorkspace: ({ baseUrl, projects, sessions }) =>
        baseUrl !== model.baseUrl
          ? noCommand(model)
          : noCommand({
              ...model,
              projects,
              sessions,
              status: 'ready',
              error: null,
            }),
      LoadedModels: ({ projectId, models, defaultModel }) =>
        projectId !== model.selectedProjectId
          ? noCommand(model)
          : noCommand({
              ...model,
              models,
              selectedModelId: defaultModel ?? models[0]?.id ?? '',
            }),
      LoadedTranscript: ({ sessionId, snapshot }) =>
        sessionId !== model.selectedSessionId
          ? noCommand(model)
          : (() => {
              const compactable = snapshot.nodes.filter(
                (node) => node.encoded.role !== 'system'
              )
              return noCommand({
                ...model,
                nodes: snapshot.nodes,
                sequence: snapshot.sequence,
                selectedBaseNodeId: snapshot.nodes.at(-1)?.id ?? null,
                compactStartNodeId: compactable[0]?.id ?? null,
                compactEndNodeId: compactable.at(-1)?.id ?? null,
              })
            })(),
      CreatedSession: ({ baseUrl, session }) =>
        baseUrl !== model.baseUrl
          ? noCommand(model)
          : [
              {
                ...model,
                sessions: [session, ...model.sessions],
                selectedSessionId: session.id,
                nodes: [],
                selectedBaseNodeId: null,
              },
              [
                LoadTranscript({
                  baseUrl: model.baseUrl,
                  sessionId: session.id,
                }),
              ],
            ],
      StartedRun: ({ baseUrl, sessionId, run }) =>
        baseUrl !== model.baseUrl || sessionId !== model.startingSessionId
          ? noCommand(model)
          : noCommand({
              ...model,
              activeRunId: run.runId,
              startingSessionId: null,
              selectedBaseNodeId: run.baseNodeId,
            }),
      StoppedRun: ({ baseUrl, runId }) =>
        baseUrl !== model.baseUrl || runId !== model.activeRunId
          ? noCommand(model)
          : noCommand({ ...model, activeRunId: null }),
      LoadedDevScenarios: ({ baseUrl, status }) =>
        baseUrl !== model.baseUrl
          ? noCommand(model)
          : [
              { ...model, devScenarios: status, scenarioBusy: false },
              model.selectedProjectId === null
                ? []
                : [
                    LoadModels({
                      baseUrl: model.baseUrl,
                      projectId: model.selectedProjectId,
                    }),
                  ],
            ],
      DevScenariosUnavailable: ({ baseUrl }) =>
        baseUrl !== model.baseUrl
          ? noCommand(model)
          : noCommand({
              ...model,
              devScenarios: null,
              scenarioBusy: false,
            }),
      StartedCompaction: ({ baseUrl, sessionId, run }) =>
        baseUrl !== model.baseUrl || sessionId !== model.selectedSessionId
          ? noCommand(model)
          : noCommand({ ...model, compactingRunId: run.runId }),
      FailedRequest: ({ baseUrl, operation, error }) =>
        baseUrl !== model.baseUrl
          ? noCommand(model)
          : noCommand({
              ...model,
              startingSessionId: null,
              status: model.projects.length === 0 ? 'error' : model.status,
              error: `${operation}: ${error}`,
            }),
      ReceivedServerEvent: ({ event }) => applyServerEvent(model, event),
    })
  )

const applyServerEvent = (
  model: Model,
  event: typeof ServerEvent.Type
): UpdateResult => {
  if ('sessionId' in event && model.selectedSessionId !== event.sessionId)
    return noCommand(model)
  switch (event._tag) {
    case 'TextDelta':
    case 'ReasoningDelta':
    case 'ToolCall':
    case 'ToolResult':
      return noCommand({
        ...model,
        activity: applyContentEvent(model.activity, event),
      })
    case 'NodeBatchCommitted': {
      const ids = new Set(event.nodes.map((node) => node.id))
      return noCommand({
        ...model,
        nodes: [
          ...model.nodes.filter((node) => !ids.has(node.id)),
          ...event.nodes,
        ],
        selectedBaseNodeId: event.headNodeId,
        sequence: Math.max(model.sequence, event.sequence),
      })
    }
    case 'RunStart':
      if (event.visibility === 'background') return noCommand(model)
      return noCommand({
        ...model,
        activeRunId: event.runId,
        startingSessionId: null,
        activity: model.activeRunId === event.runId ? model.activity : [],
      })
    case 'RunEnd':
      if (event.runId === model.compactingRunId) {
        return noCommand({
          ...model,
          compactingRunId: null,
          sequence: Math.max(model.sequence, event.sequence),
        })
      }
      if (event.runId !== model.activeRunId) {
        return noCommand({
          ...model,
          sequence: Math.max(model.sequence, event.sequence),
        })
      }
      return noCommand({
        ...model,
        activeRunId: null,
        activity: [],
        sequence: Math.max(model.sequence, event.sequence),
      })
    case 'RunFailed':
      return event.runId !== model.activeRunId
        ? noCommand(model)
        : noCommand({
            ...model,
            activeRunId: null,
            error: event.message,
          })
    case 'ReplayReset':
      return model.selectedSessionId === null
        ? noCommand(model)
        : [
            model,
            [
              LoadTranscript({
                baseUrl: model.baseUrl,
                sessionId: model.selectedSessionId,
              }),
            ],
          ]
    case 'SessionTitleUpdated':
      return noCommand({
        ...model,
        sessions: model.sessions.map((session) =>
          session.id === event.sessionId
            ? { ...session, title: event.title, updatedAt: event.updatedAt }
            : session
        ),
        sequence: Math.max(model.sequence, event.sequence),
      })
    case 'ActiveRunUpserted':
      return event.visibility !== 'primary'
        ? noCommand({
            ...model,
            sequence: Math.max(model.sequence, event.sequence),
          })
        : noCommand({
            ...model,
            activeRunId: event.runId,
            sequence: Math.max(model.sequence, event.sequence),
          })
    case 'RunBaseUpdated':
      return event.runId !== model.activeRunId
        ? noCommand(model)
        : noCommand({ ...model, selectedBaseNodeId: event.baseNodeId })
    case 'RunRetrying':
      return noCommand({ ...model, error: `${event.title}: ${event.message}` })
  }
}

export const application = { Model, init, update, view, subscriptions }
