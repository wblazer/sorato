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
  CreateSessionAndStartRun,
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
  StartedNewSession,
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

const AppTab = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
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
  compactionActivity: Schema.Array(StreamActivity),
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
  sidePanel: Schema.Literals(['tree', 'diff']),
  treePanelOpen: Schema.Boolean,
  tabs: Schema.Array(AppTab),
  activeTabId: Schema.String,
  nextTabId: Schema.Number,
  overlay: Schema.NullOr(Schema.Literals(['search', 'settings', 'lab'])),
  sessionSearch: Schema.String,
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
export const ClickedNewTab = m('ClickedNewTab')
export const SelectedTab = m('SelectedTab', { id: Schema.String })
export const ClosedTab = m('ClosedTab', { id: Schema.String })
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
export const SelectedSidePanel = m('SelectedSidePanel', {
  panel: Schema.Literals(['tree', 'diff']),
})
export const ClickedToggleTreePanel = m('ClickedToggleTreePanel')
export const OpenedOverlay = m('OpenedOverlay', {
  overlay: Schema.Literals(['search', 'settings', 'lab']),
})
export const ClosedOverlay = m('ClosedOverlay')
export const ChangedSessionSearch = m('ChangedSessionSearch', {
  value: Schema.String,
})
export const ClearedError = m('ClearedError')

export const Message = Schema.Union([
  ChangedServerUrl,
  ClickedConnect,
  ChangedProjectFilter,
  SelectedProject,
  ClickedCreateSession,
  ClickedNewTab,
  SelectedTab,
  ClosedTab,
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
  SelectedSidePanel,
  ClickedToggleTreePanel,
  OpenedOverlay,
  ClosedOverlay,
  ChangedSessionSearch,
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
  StartedNewSession,
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
  compactionActivity: [],
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
  sidePanel: 'tree',
  treePanelOpen: true,
  tabs: [{ id: 'tab-0', sessionId: null, projectId: null }],
  activeTabId: 'tab-0',
  nextTabId: 1,
  overlay: null,
  sessionSearch: '',
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

const selectedNodePath = (
  nodes: ReadonlyArray<MessageNodeResponse>,
  headId: string | null
): ReadonlyArray<MessageNodeResponse> => {
  if (headId === null) return []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const path: Array<MessageNodeResponse> = []
  const seen = new Set<string>()
  let cursor: string | null = headId
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (node === undefined) return []
    path.push(node)
    cursor = node.parentId
  }
  return path.reverse()
}

const selectBaseNode = (model: Model, id: string): Model => {
  const compactable = selectedNodePath(model.nodes, id).filter(
    (node) => node.encoded.role !== 'system'
  )
  return {
    ...model,
    selectedBaseNodeId: id,
    compactStartNodeId: compactable[0]?.id ?? null,
    compactEndNodeId: compactable.at(-1)?.id ?? null,
  }
}

const selectTab = (model: Model, id: string): UpdateResult => {
  const tab = model.tabs.find((candidate) => candidate.id === id)
  if (tab === undefined) return noCommand(model)
  if (tab.sessionId === null) {
    const projectId = tab.projectId ?? model.selectedProjectId
    const projectChanged = projectId !== model.selectedProjectId
    return [
      {
        ...model,
        activeTabId: id,
        selectedProjectId: projectId,
        selectedSessionId: null,
        selectedBaseNodeId: null,
        models: projectChanged ? [] : model.models,
        selectedModelId: projectChanged ? '' : model.selectedModelId,
        nodes: [],
        activity: [],
        activeRunId: null,
        compactingRunId: null,
        startingSessionId: null,
        compactStartNodeId: null,
        compactEndNodeId: null,
        sequence: 0,
      },
      projectChanged && projectId !== null
        ? [LoadModels({ baseUrl: model.baseUrl, projectId })]
        : [],
    ]
  }
  const session = model.sessions.find(
    (candidate) => candidate.id === tab.sessionId
  )
  if (session === undefined) return noCommand(model)
  const projectChanged = session.projectId !== model.selectedProjectId
  const activeRunId =
    session.activeRuns?.find((run) => run.visibility === 'primary')?.runId ??
    null
  return [
    {
      ...model,
      activeTabId: id,
      selectedProjectId: session.projectId,
      selectedSessionId: session.id,
      models: projectChanged ? [] : model.models,
      selectedModelId: projectChanged ? '' : model.selectedModelId,
      nodes: [],
      activity: [],
      selectedBaseNodeId: null,
      activeRunId,
      startingSessionId: null,
      sequence: 0,
    },
    [
      LoadTranscript({ baseUrl: model.baseUrl, sessionId: session.id }),
      ...(projectChanged
        ? [
            LoadModels({
              baseUrl: model.baseUrl,
              projectId: session.projectId,
            }),
          ]
        : []),
    ],
  ]
}

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
            compactionActivity: [],
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
            tabs: [
              {
                id: `tab-${model.nextTabId}`,
                sessionId: null,
                projectId: null,
              },
            ],
            activeTabId: `tab-${model.nextTabId}`,
            nextTabId: model.nextTabId + 1,
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
          tabs: model.tabs.map((tab) =>
            tab.id === model.activeTabId ? { ...tab, projectId: id } : tab
          ),
          selectedProjectId: id,
          selectedSessionId: null,
          models: [],
          selectedModelId: '',
          nodes: [],
          activity: [],
          sequence: 0,
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
      ClickedNewTab: () => {
        const tab = {
          id: `tab-${model.nextTabId}`,
          sessionId: null,
          projectId: model.selectedProjectId,
        }
        return selectTab(
          {
            ...model,
            tabs: [tab, ...model.tabs],
            nextTabId: model.nextTabId + 1,
          },
          tab.id
        )
      },
      SelectedTab: ({ id }) => selectTab(model, id),
      ClosedTab: ({ id }) => {
        const index = model.tabs.findIndex((tab) => tab.id === id)
        if (index < 0) return noCommand(model)
        const remaining = model.tabs.filter((tab) => tab.id !== id)
        if (remaining.length === 0) {
          const replacement = {
            id: `tab-${model.nextTabId}`,
            sessionId: null,
            projectId: model.selectedProjectId,
          }
          return selectTab(
            {
              ...model,
              tabs: [replacement],
              nextTabId: model.nextTabId + 1,
            },
            replacement.id
          )
        }
        if (id !== model.activeTabId)
          return noCommand({ ...model, tabs: remaining })
        const next = remaining[Math.min(index, remaining.length - 1)]
        return next === undefined
          ? noCommand(model)
          : selectTab({ ...model, tabs: remaining }, next.id)
      },
      SelectedSession: ({ id }) => {
        const session = model.sessions.find((candidate) => candidate.id === id)
        if (session === undefined) return noCommand(model)
        const existing = model.tabs.find((tab) => tab.sessionId === id)
        if (existing !== undefined)
          return selectTab(
            { ...model, overlay: null, sessionSearch: '' },
            existing.id
          )
        const tabs = model.tabs.map((tab) =>
          tab.id === model.activeTabId
            ? { ...tab, sessionId: id, projectId: session.projectId }
            : tab
        )
        return selectTab(
          { ...model, tabs, overlay: null, sessionSearch: '' },
          model.activeTabId
        )
      },
      SelectedModel: ({ id }) => noCommand({ ...model, selectedModelId: id }),
      SelectedBaseNode: ({ id }) => noCommand(selectBaseNode(model, id)),
      ChangedDraft: ({ value }) => noCommand({ ...model, draft: value }),
      ClickedSend: () => {
        const projectId = model.selectedProjectId
        const sessionId = model.selectedSessionId
        if (
          model.selectedModelId === '' ||
          model.draft.trim() === '' ||
          model.activeRunId !== null ||
          model.startingSessionId !== null ||
          (sessionId === null && projectId === null)
        )
          return noCommand(model)
        if (sessionId === null) {
          if (projectId === null) return noCommand(model)
          return [
            {
              ...model,
              draft: '',
              error: null,
              startingSessionId: 'new',
            },
            [
              CreateSessionAndStartRun({
                baseUrl: model.baseUrl,
                projectId,
                input: model.draft.trim(),
                model: model.selectedModelId,
              }),
            ],
          ]
        }
        return [
          {
            ...model,
            draft: '',
            error: null,
            startingSessionId: sessionId,
          },
          [
            StartRun({
              baseUrl: model.baseUrl,
              sessionId,
              input: model.draft.trim(),
              model: model.selectedModelId,
              baseNodeId: model.selectedBaseNodeId,
            }),
          ],
        ]
      },
      ClickedStop: () =>
        model.activeRunId === null
          ? noCommand(model)
          : [
              model,
              [StopRun({ baseUrl: model.baseUrl, runId: model.activeRunId })],
            ],
      SelectedDevScenario: ({ id }) =>
        model.scenarioBusy ||
        model.startingSessionId !== null ||
        model.activeRunId !== null ||
        model.compactingRunId !== null
          ? noCommand(model)
          : [
              { ...model, scenarioBusy: true },
              [
                id === null
                  ? DeactivateDevScenario({ baseUrl: model.baseUrl })
                  : ActivateDevScenario({
                      baseUrl: model.baseUrl,
                      scenario: id,
                    }),
              ],
            ],
      ClickedRunScenario: () => {
        const projectId = model.selectedProjectId
        const sessionId = model.selectedSessionId
        if (
          (sessionId === null && projectId === null) ||
          model.devScenarios === null ||
          model.devScenarios.activeScenario === null ||
          model.activeRunId !== null ||
          model.compactingRunId !== null ||
          model.startingSessionId !== null
        )
          return noCommand(model)
        const input = `Exercise the ${model.devScenarios.activeScenario} development scenario.`
        if (sessionId === null) {
          if (projectId === null) return noCommand(model)
          return [
            { ...model, error: null, startingSessionId: 'new' },
            [
              CreateSessionAndStartRun({
                baseUrl: model.baseUrl,
                projectId,
                input,
                model: 'mock/streaming-demo',
              }),
            ],
          ]
        }
        return [
          {
            ...model,
            error: null,
            startingSessionId: sessionId,
          },
          [
            StartRun({
              baseUrl: model.baseUrl,
              sessionId,
              input,
              model: 'mock/streaming-demo',
              baseNodeId: model.selectedBaseNodeId,
            }),
          ],
        ]
      },
      SelectedCompactStart: ({ id }) =>
        noCommand({ ...model, compactStartNodeId: id }),
      SelectedCompactEnd: ({ id }) =>
        noCommand({ ...model, compactEndNodeId: id }),
      SelectedSidePanel: ({ panel }) =>
        noCommand({ ...model, sidePanel: panel }),
      ClickedToggleTreePanel: () =>
        noCommand({ ...model, treePanelOpen: !model.treePanelOpen }),
      OpenedOverlay: ({ overlay }) => noCommand({ ...model, overlay }),
      ClosedOverlay: () => noCommand({ ...model, overlay: null }),
      ChangedSessionSearch: ({ value }) =>
        noCommand({ ...model, sessionSearch: value }),
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
      LoadedWorkspace: ({ baseUrl, projects, sessions }) => {
        if (baseUrl !== model.baseUrl) return noCommand(model)
        const projectId = model.selectedProjectId ?? projects[0]?.id ?? null
        return [
          {
            ...model,
            projects,
            sessions,
            tabs: model.tabs.map((tab) =>
              tab.id === model.activeTabId && tab.projectId === null
                ? { ...tab, projectId }
                : tab
            ),
            selectedProjectId: projectId,
            status: 'ready',
            error: null,
          },
          model.selectedProjectId === null && projectId !== null
            ? [LoadModels({ baseUrl: model.baseUrl, projectId })]
            : [],
        ]
      },
      LoadedModels: ({ baseUrl, projectId, models, defaultModel }) =>
        baseUrl !== model.baseUrl || projectId !== model.selectedProjectId
          ? noCommand(model)
          : noCommand({
              ...model,
              models,
              selectedModelId:
                (model.devScenarios?.activeScenario === null
                  ? undefined
                  : models.find((item) => item.id === 'mock/streaming-demo')
                      ?.id) ??
                defaultModel ??
                models[0]?.id ??
                '',
            }),
      LoadedTranscript: ({ baseUrl, sessionId, snapshot }) =>
        baseUrl !== model.baseUrl || sessionId !== model.selectedSessionId
          ? noCommand(model)
          : snapshot.sequence < model.sequence
            ? noCommand(model)
            : (() => {
                const selectedBaseNodeId =
                  model.selectedBaseNodeId !== null &&
                  snapshot.nodes.some(
                    (node) => node.id === model.selectedBaseNodeId
                  )
                    ? model.selectedBaseNodeId
                    : (snapshot.nodes.at(-1)?.id ?? null)
                const compactable = selectedNodePath(
                  snapshot.nodes,
                  selectedBaseNodeId
                ).filter((node) => node.encoded.role !== 'system')
                return noCommand({
                  ...model,
                  nodes: snapshot.nodes,
                  sequence: snapshot.sequence,
                  selectedBaseNodeId,
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
                tabs: model.tabs.map((tab) =>
                  tab.id === model.activeTabId
                    ? {
                        ...tab,
                        sessionId: session.id,
                        projectId: session.projectId,
                      }
                    : tab
                ),
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
          : noCommand({
              ...model,
              compactingRunId: run.runId,
              compactionActivity: [],
            }),
      StartedNewSession: ({ baseUrl, session, run }) =>
        baseUrl !== model.baseUrl || model.startingSessionId !== 'new'
          ? noCommand(model)
          : noCommand({
              ...model,
              sessions: [session, ...model.sessions],
              tabs: model.tabs.map((tab) =>
                tab.id === model.activeTabId
                  ? {
                      ...tab,
                      sessionId: session.id,
                      projectId: session.projectId,
                    }
                  : tab
              ),
              selectedSessionId: session.id,
              selectedProjectId: session.projectId,
              selectedBaseNodeId: run.baseNodeId,
              activeRunId: run.runId,
              startingSessionId: null,
              nodes: [],
              activity: [],
            }),
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
      if (event.runId === model.compactingRunId)
        return noCommand({
          ...model,
          compactionActivity: applyContentEvent(
            model.compactionActivity,
            event
          ),
        })
      return event.runId === model.activeRunId
        ? noCommand({
            ...model,
            activity: applyContentEvent(model.activity, event),
          })
        : noCommand(model)
    case 'NodeBatchCommitted': {
      if (event.sequence <= model.sequence || model.selectedSessionId === null)
        return noCommand(model)
      return [
        {
          ...model,
          selectedBaseNodeId: event.headNodeId,
          sequence: event.sequence,
        },
        [
          LoadTranscript({
            baseUrl: model.baseUrl,
            sessionId: model.selectedSessionId,
          }),
        ],
      ]
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
        return model.selectedSessionId === null
          ? noCommand(model)
          : [
              {
                ...model,
                compactingRunId: null,
                compactionActivity: [],
              },
              [
                LoadTranscript({
                  baseUrl: model.baseUrl,
                  sessionId: model.selectedSessionId,
                }),
              ],
            ]
      }
      if (event.runId !== model.activeRunId) {
        return noCommand(model)
      }
      return model.selectedSessionId === null
        ? noCommand(model)
        : [
            {
              ...model,
              activeRunId: null,
              activity: [],
            },
            [
              LoadTranscript({
                baseUrl: model.baseUrl,
                sessionId: model.selectedSessionId,
              }),
            ],
          ]
    case 'RunFailed':
      if (event.runId === model.compactingRunId)
        return noCommand({
          ...model,
          compactingRunId: null,
          compactionActivity: [],
          error: event.message,
        })
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
