import {
  DevScenarioId,
  DevScenariosStatus,
  MessageNodeResponse,
  ModelOption,
  ProjectResponse,
  ServerEvent,
  SessionResponse,
  ToolInfo,
} from '@sorato/api'
import { Match as M, Schema } from 'effect'
import * as Option from 'effect/Option'
import * as Combobox from '@foldkit/ui/combobox'
import * as Dialog from '@foldkit/ui/dialog'
import * as Tabs from '@foldkit/ui/tabs'
import * as Listbox from '@foldkit/ui/listbox'
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
  LoadHandshake,
  LoadedHandshake,
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
  ClientConfigSchema,
  ClientSettingsSchema,
  defaultClientSettings,
  diffClientConfig,
  resolveClientConfig,
} from './client-config.ts'
import {
  clampSidebarWidth,
  clampTreePanelWidth,
  defaultSidebarWidth,
  defaultTreePanelWidth,
} from './layout.ts'
import {
  CopySettings,
  CopiedSettings,
  FailedCopyingSettings,
  FailedSavingSettings,
  HydrateBrowser,
  HydratedBrowserState,
  PersistedLayout,
  PointerInteractionsEnded,
  SaveLayout,
  SaveSettings,
  SavedSettings,
  ViewportResized,
} from './browser.ts'
import {
  ReceivedServerEvent,
  acknowledgeActivityThrough,
  applyContentEvent,
  subscriptions,
} from './events.ts'
import { view } from './view.ts'
import { buildTreeModel, flattenTree } from './tree-model.ts'

const StreamActivity = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['text', 'reasoning', 'tool-call', 'tool-result']),
  title: Schema.String,
  body: Schema.String,
  failed: Schema.Boolean,
  chunks: Schema.Array(
    Schema.Struct({ eventId: Schema.Number, body: Schema.String })
  ),
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
  contentWatermarks: Schema.Record(Schema.String, Schema.Number),
  selectedProjectId: Schema.NullOr(Schema.String),
  selectedSessionId: Schema.NullOr(Schema.String),
  selectedModelId: Schema.String,
  selectedBaseNodeId: Schema.NullOr(Schema.String),
  selectedRunId: Schema.NullOr(Schema.String),
  draft: Schema.String,
  projectFilter: Schema.String,
  activeRunId: Schema.NullOr(Schema.String),
  stoppingRunId: Schema.NullOr(Schema.String),
  compactingRunId: Schema.NullOr(Schema.String),
  startingSessionId: Schema.NullOr(Schema.String),
  devScenarios: Schema.NullOr(DevScenariosStatus),
  scenarioBusy: Schema.Boolean,
  compactStartNodeId: Schema.NullOr(Schema.String),
  compactEndNodeId: Schema.NullOr(Schema.String),
  compactInstructions: Schema.String,
  treeCompactMode: Schema.Boolean,
  groupAgentSteps: Schema.Boolean,
  compactDragStartNodeId: Schema.NullOr(Schema.String),
  sidePanel: Schema.Literals(['tree', 'diff']),
  treePanelOpen: Schema.Boolean,
  tabs: Schema.Array(AppTab),
  activeTabId: Schema.String,
  nextTabId: Schema.Number,
  overlay: Schema.NullOr(
    Schema.Literals(['search', 'connection', 'settings', 'lab'])
  ),
  dialog: Dialog.Model,
  modelCombobox: Combobox.Model,
  projectCombobox: Combobox.Model,
  sidePanelTabs: Tabs.Model,
  settingsTabs: Tabs.Model,
  settingsTab: Schema.Literals(['general', 'keybinds']),
  openDisclosures: Schema.Array(Schema.String),
  sessionSearch: Schema.String,
  sequence: Schema.Number,
  error: Schema.NullOr(Schema.String),
  clientConfigOverrides: ClientConfigSchema,
  clientSettings: ClientSettingsSchema,
  settingsRevision: Schema.Number,
  savedSettingsRevision: Schema.Number,
  settingsSaving: Schema.Boolean,
  settingsResetConfirm: Schema.Boolean,
  settingsCopied: Schema.Boolean,
  settingsError: Schema.NullOr(Schema.String),
  serverVersion: Schema.NullOr(Schema.String),
  serverTools: Schema.Array(ToolInfo),
  handshakeLoading: Schema.Boolean,
  sidebarWidth: Schema.Number,
  treePanelWidth: Schema.Number,
  viewportWidth: Schema.Number,
  resizing: Schema.NullOr(
    Schema.Struct({
      target: Schema.Literals(['sidebar', 'tree']),
      startX: Schema.Number,
      startWidth: Schema.Number,
    })
  ),
  transcriptListbox: Listbox.Model,
  scenarioListbox: Listbox.Model,
  compactStartListbox: Listbox.Model,
  compactEndListbox: Listbox.Model,
  toolListboxes: Schema.Record(Schema.String, Listbox.Model),
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
export const SelectedRunHead = m('SelectedRunHead', {
  runId: Schema.String,
  baseNodeId: Schema.NullOr(Schema.String),
})
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
export const ToggledTreeCompactMode = m('ToggledTreeCompactMode')
export const ToggledGroupAgentSteps = m('ToggledGroupAgentSteps', {
  value: Schema.Boolean,
})
export const AdjustedTreeCompactRange = m('AdjustedTreeCompactRange', {
  startId: Schema.String,
  endId: Schema.String,
  phase: Schema.Literals(['select', 'start', 'move', 'end']),
})
export const ChangedCompactInstructions = m('ChangedCompactInstructions', {
  value: Schema.String,
})
export const ClickedCompact = m('ClickedCompact')
export const SelectedSidePanel = m('SelectedSidePanel', {
  panel: Schema.Literals(['tree', 'diff']),
})
export const ClickedToggleTreePanel = m('ClickedToggleTreePanel')
export const OpenedOverlay = m('OpenedOverlay', {
  overlay: Schema.Literals(['search', 'connection', 'settings', 'lab']),
})
export const ClosedOverlay = m('ClosedOverlay')
export const GotDialogMessage = m('GotDialogMessage', {
  message: Dialog.Message,
})
export const GotModelComboboxMessage = m('GotModelComboboxMessage', {
  message: Combobox.Message,
})
export const GotProjectComboboxMessage = m('GotProjectComboboxMessage', {
  message: Combobox.Message,
})
export const GotSidePanelTabsMessage = m('GotSidePanelTabsMessage', {
  message: Tabs.Message,
})
export const GotSettingsTabsMessage = m('GotSettingsTabsMessage', {
  message: Tabs.Message,
})
export const ToggledDisclosure = m('ToggledDisclosure', {
  id: Schema.String,
  isOpen: Schema.Boolean,
})
export const ChangedSessionSearch = m('ChangedSessionSearch', {
  value: Schema.String,
})
export const ClearedError = m('ClearedError')
export const ChangedSetting = m('ChangedSetting', {
  setting: Schema.Literals(['system', 'tool-default']),
  value: Schema.Boolean,
})
export const SelectedTranscriptMode = m('SelectedTranscriptMode', {
  value: Schema.Literals(['pretty', 'raw']),
})
export const SelectedToolPreference = m('SelectedToolPreference', {
  tool: Schema.String,
  value: Schema.Literals(['default', 'expanded', 'collapsed']),
})
export const ClickedResetSettings = m('ClickedResetSettings')
export const ConfirmedResetSettings = m('ConfirmedResetSettings')
export const ClickedCopySettings = m('ClickedCopySettings')
export const GotListboxMessage = m('GotListboxMessage', {
  target: Schema.String,
  message: Listbox.Message,
})
export const StartedResize = m('StartedResize', {
  target: Schema.Literals(['sidebar', 'tree']),
  x: Schema.Number,
  viewportWidth: Schema.Number,
})
export const MovedResize = m('MovedResize', { x: Schema.Number })
export const EndedResize = m('EndedResize')

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
  SelectedRunHead,
  ChangedDraft,
  ClickedSend,
  ClickedStop,
  SelectedDevScenario,
  ClickedRunScenario,
  SelectedCompactStart,
  SelectedCompactEnd,
  ToggledTreeCompactMode,
  ToggledGroupAgentSteps,
  AdjustedTreeCompactRange,
  ChangedCompactInstructions,
  ClickedCompact,
  SelectedSidePanel,
  ClickedToggleTreePanel,
  OpenedOverlay,
  ClosedOverlay,
  GotDialogMessage,
  GotModelComboboxMessage,
  GotProjectComboboxMessage,
  GotSidePanelTabsMessage,
  GotSettingsTabsMessage,
  ToggledDisclosure,
  ChangedSessionSearch,
  ClearedError,
  ChangedSetting,
  SelectedTranscriptMode,
  SelectedToolPreference,
  ClickedResetSettings,
  ConfirmedResetSettings,
  ClickedCopySettings,
  GotListboxMessage,
  StartedResize,
  MovedResize,
  EndedResize,
  ViewportResized,
  PointerInteractionsEnded,
  HydratedBrowserState,
  SavedSettings,
  PersistedLayout,
  CopiedSettings,
  FailedSavingSettings,
  FailedCopyingSettings,
  LoadedHandshake,
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
  contentWatermarks: {},
  selectedProjectId: null,
  selectedSessionId: null,
  selectedModelId: '',
  selectedBaseNodeId: null,
  selectedRunId: null,
  draft: '',
  projectFilter: '',
  activeRunId: null,
  stoppingRunId: null,
  compactingRunId: null,
  startingSessionId: null,
  devScenarios: null,
  scenarioBusy: false,
  compactStartNodeId: null,
  compactEndNodeId: null,
  compactInstructions: '',
  treeCompactMode: false,
  groupAgentSteps: true,
  compactDragStartNodeId: null,
  sidePanel: 'tree',
  treePanelOpen: true,
  tabs: [{ id: 'tab-0', sessionId: null, projectId: null }],
  activeTabId: 'tab-0',
  nextTabId: 1,
  overlay: null,
  dialog: Dialog.init({ id: 'app-overlay' }),
  modelCombobox: Combobox.init({ id: 'model-combobox' }),
  projectCombobox: Combobox.init({ id: 'project-combobox' }),
  sidePanelTabs: Tabs.init({ id: 'side-panel-tabs' }),
  settingsTabs: Tabs.init({ id: 'settings-tabs' }),
  settingsTab: 'general',
  openDisclosures: [],
  sessionSearch: '',
  sequence: 0,
  error: null,
  clientConfigOverrides: {},
  clientSettings: defaultClientSettings(),
  settingsRevision: 0,
  savedSettingsRevision: 0,
  settingsSaving: false,
  settingsResetConfirm: false,
  settingsCopied: false,
  settingsError: null,
  serverVersion: null,
  serverTools: [],
  handshakeLoading: true,
  sidebarWidth: defaultSidebarWidth,
  treePanelWidth: defaultTreePanelWidth,
  viewportWidth: 1440,
  resizing: null,
  transcriptListbox: Listbox.init({ id: 'transcript-mode' }),
  scenarioListbox: Listbox.init({ id: 'scenario' }),
  compactStartListbox: Listbox.init({ id: 'compact-start' }),
  compactEndListbox: Listbox.init({ id: 'compact-end' }),
  toolListboxes: {},
})

export const init: Runtime.ApplicationInit<Model, Message> = () => [
  initialModel,
  [
    LoadWorkspace({ baseUrl: initialModel.baseUrl }),
    LoadDevScenarios({ baseUrl: initialModel.baseUrl }),
    LoadHandshake({ baseUrl: initialModel.baseUrl }),
    HydrateBrowser(),
  ],
]

type UpdateResult = readonly [Model, ReadonlyArray<Command.Command<Message>>]
const noCommand = (model: Model): UpdateResult => [model, []]
const ModelCombobox = Combobox.create<string>()
const ProjectCombobox = Combobox.create<string>()
const SidePanelTabs = Tabs.create<'tree' | 'diff'>()
const SettingsTabs = Tabs.create<'general' | 'keybinds'>()
const StringListbox = Listbox.create<string>()

const saveSettings = (
  model: Model,
  settings: Model['clientSettings'],
  wasReset = false
): UpdateResult => {
  const revision = model.settingsRevision + 1
  const base = resolveClientConfig().resolved
  const resolved = {
    expand_tool_blocks_by_default: settings.toolBlockExpansion.default,
    tool_block_expansion: settings.toolBlockExpansion,
    transcript_display_mode: settings.transcriptDisplayMode,
    expand_system_messages_by_default: settings.expandSystemMessagesByDefault,
  }
  const overrides = diffClientConfig(base, resolved)
  return [
    {
      ...model,
      clientSettings: settings,
      clientConfigOverrides: overrides,
      settingsRevision: revision,
      settingsSaving: true,
      settingsResetConfirm: false,
      settingsError: null,
    },
    [
      SaveSettings({
        revision,
        overrides,
        settings,
        rollbackOverrides: model.clientConfigOverrides,
        rollbackSettings: model.clientSettings,
        wasReset,
      }),
    ],
  ]
}

const dialogResult = (
  model: Model,
  result: ReturnType<typeof Dialog.update>
): UpdateResult => {
  const next = { ...model, dialog: result[0] }
  return [
    Option.match(result[2], {
      onNone: () => next,
      onSome: (out) =>
        out._tag === 'Closed' ? { ...next, overlay: null } : next,
    }),
    Command.mapMessages(result[1], (message) => GotDialogMessage({ message })),
  ]
}

const modelComboboxResult = (
  model: Model,
  result: ReturnType<typeof ModelCombobox.update>
): UpdateResult => {
  const next = { ...model, modelCombobox: result[0] }
  return [
    Option.match(result[2], {
      onNone: () => next,
      onSome: (out) =>
        out._tag === 'Selected'
          ? { ...next, selectedModelId: out.value }
          : next,
    }),
    Command.mapMessages(result[1], (message) =>
      GotModelComboboxMessage({ message })
    ),
  ]
}

const sideTabsResult = (
  model: Model,
  result: ReturnType<typeof SidePanelTabs.update>
): UpdateResult => {
  const next = { ...model, sidePanelTabs: result[0] }
  return [
    Option.match(result[2], {
      onNone: () => next,
      onSome: (out) => ({ ...next, sidePanel: out.value }),
    }),
    Command.mapMessages(result[1], (message) =>
      GotSidePanelTabsMessage({ message })
    ),
  ]
}

const settingsTabsResult = (
  model: Model,
  result: ReturnType<typeof SettingsTabs.update>
): UpdateResult => {
  const next = { ...model, settingsTabs: result[0] }
  return [
    Option.match(result[2], {
      onNone: () => next,
      onSome: (out) => ({ ...next, settingsTab: out.value }),
    }),
    Command.mapMessages(result[1], (message) =>
      GotSettingsTabsMessage({ message })
    ),
  ]
}

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
    selectedRunId: null,
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
        selectedRunId: null,
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
      selectedRunId: activeRunId,
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
            contentWatermarks: {},
            selectedProjectId: null,
            selectedSessionId: null,
            selectedModelId: '',
            selectedBaseNodeId: null,
            selectedRunId: null,
            activeRunId: null,
            stoppingRunId: null,
            compactingRunId: null,
            startingSessionId: null,
            devScenarios: null,
            scenarioBusy: false,
            compactStartNodeId: null,
            compactEndNodeId: null,
            compactDragStartNodeId: null,
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
          [
            LoadWorkspace({ baseUrl }),
            LoadDevScenarios({ baseUrl }),
            LoadHandshake({ baseUrl }),
          ],
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
          selectedBaseNodeId: null,
          selectedRunId: null,
          activeRunId: null,
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
      SelectedRunHead: ({ runId, baseNodeId }) =>
        noCommand({
          ...model,
          selectedRunId: runId,
          selectedBaseNodeId: baseNodeId,
        }),
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
        model.activeRunId === null || model.stoppingRunId !== null
          ? noCommand(model)
          : [
              { ...model, stoppingRunId: model.activeRunId },
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
      ToggledTreeCompactMode: () =>
        noCommand({
          ...model,
          treeCompactMode: !model.treeCompactMode,
          compactDragStartNodeId: null,
        }),
      ToggledGroupAgentSteps: ({ value }) => [
        { ...model, groupAgentSteps: value },
        [
          SaveLayout({
            sidebarWidth: model.sidebarWidth,
            treePanelWidth: model.treePanelWidth,
            treePanelOpen: model.treePanelOpen,
            groupAgentSteps: value,
          }),
        ],
      ],
      AdjustedTreeCompactRange: ({ startId, endId, phase }) => {
        if (phase === 'select')
          return noCommand({
            ...model,
            compactStartNodeId: startId,
            compactEndNodeId: endId,
            compactDragStartNodeId: null,
          })
        if (phase === 'start') {
          const tree = buildTreeModel(model.nodes, model.groupAgentSteps)
          return noCommand({
            ...model,
            compactStartNodeId: startId,
            compactEndNodeId: endId,
            compactDragStartNodeId: tree.ownerByNodeId.get(startId) ?? null,
          })
        }
        if (phase === 'move' && model.compactDragStartNodeId !== null) {
          const tree = buildTreeModel(model.nodes, model.groupAgentSteps)
          const rows = flattenTree(tree, model.selectedBaseNodeId).filter(
            (row) =>
              row.inSelectedPath && row.item.message.encoded.role !== 'system'
          )
          const anchorIndex = rows.findIndex(
            (row) => row.item.id === model.compactDragStartNodeId
          )
          const hoverOwner = tree.ownerByNodeId.get(endId)
          const hoverIndex = rows.findIndex((row) => row.item.id === hoverOwner)
          if (anchorIndex < 0 || hoverIndex < 0) return noCommand(model)
          const earlier = rows[Math.min(anchorIndex, hoverIndex)]
          const later = rows[Math.max(anchorIndex, hoverIndex)]
          if (earlier === undefined || later === undefined)
            return noCommand(model)
          return noCommand({
            ...model,
            compactStartNodeId: earlier.item.compactStartNodeId,
            compactEndNodeId: later.item.compactEndNodeId,
          })
        }
        return noCommand({ ...model, compactDragStartNodeId: null })
      },
      ChangedCompactInstructions: ({ value }) =>
        noCommand({ ...model, compactInstructions: value }),
      SelectedSidePanel: ({ panel }) =>
        noCommand({ ...model, sidePanel: panel }),
      ClickedToggleTreePanel: () => [
        { ...model, treePanelOpen: !model.treePanelOpen },
        [
          SaveLayout({
            sidebarWidth: model.sidebarWidth,
            treePanelWidth: model.treePanelWidth,
            treePanelOpen: !model.treePanelOpen,
            groupAgentSteps: model.groupAgentSteps,
          }),
        ],
      ],
      OpenedOverlay: ({ overlay }) =>
        dialogResult(
          {
            ...model,
            overlay,
            settingsCopied:
              overlay === 'settings' ? false : model.settingsCopied,
            settingsError: overlay === 'settings' ? null : model.settingsError,
          },
          Dialog.open(model.dialog)
        ),
      ClosedOverlay: () =>
        dialogResult(
          model,
          Dialog.update(model.dialog, Dialog.RequestedClose())
        ),
      GotDialogMessage: ({ message }) =>
        dialogResult(model, Dialog.update(model.dialog, message)),
      GotModelComboboxMessage: ({ message }) =>
        modelComboboxResult(
          model,
          ModelCombobox.update(model.modelCombobox, message)
        ),
      GotProjectComboboxMessage: ({ message }) => {
        const result = ProjectCombobox.update(model.projectCombobox, message)
        const selected = Option.getOrUndefined(result[2])
        const next = { ...model, projectCombobox: result[0] }
        if (selected?._tag !== 'Selected')
          return [
            next,
            Command.mapMessages(result[1], (childMessage) =>
              GotProjectComboboxMessage({ message: childMessage })
            ),
          ]
        const [selectedModel, commands] = update(
          next,
          SelectedProject({ id: selected.value })
        )
        return [
          selectedModel,
          [
            ...Command.mapMessages(result[1], (childMessage) =>
              GotProjectComboboxMessage({ message: childMessage })
            ),
            ...commands,
          ],
        ]
      },
      GotSidePanelTabsMessage: ({ message }) =>
        sideTabsResult(
          model,
          SidePanelTabs.update(model.sidePanelTabs, message)
        ),
      GotSettingsTabsMessage: ({ message }) =>
        settingsTabsResult(
          model,
          SettingsTabs.update(model.settingsTabs, message)
        ),
      ToggledDisclosure: ({ id, isOpen }) =>
        noCommand({
          ...model,
          openDisclosures: isOpen
            ? [
                ...new Set([
                  ...model.openDisclosures.filter(
                    (candidate) =>
                      candidate !==
                      (id.startsWith('closed:') ? id.slice(7) : `closed:${id}`)
                  ),
                  id,
                ]),
              ]
            : model.openDisclosures.filter((candidate) => candidate !== id),
        }),
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
                  instructions: model.compactInstructions.trim(),
                }),
              ],
            ],
      ClearedError: () => noCommand({ ...model, error: null }),
      ChangedSetting: ({ setting, value }) =>
        saveSettings(
          model,
          setting === 'system'
            ? { ...model.clientSettings, expandSystemMessagesByDefault: value }
            : {
                ...model.clientSettings,
                toolBlockExpansion: {
                  ...model.clientSettings.toolBlockExpansion,
                  default: value,
                },
              }
        ),
      SelectedTranscriptMode: ({ value }) =>
        saveSettings(model, {
          ...model.clientSettings,
          transcriptDisplayMode: value,
        }),
      SelectedToolPreference: ({ tool, value }) => {
        const tools = { ...model.clientSettings.toolBlockExpansion.tools }
        if (value === 'default') delete tools[tool]
        else tools[tool] = value === 'expanded'
        return saveSettings(model, {
          ...model.clientSettings,
          toolBlockExpansion: {
            ...model.clientSettings.toolBlockExpansion,
            tools,
          },
        })
      },
      ClickedResetSettings: () =>
        noCommand({ ...model, settingsResetConfirm: true }),
      ConfirmedResetSettings: () =>
        saveSettings(model, defaultClientSettings(), true),
      ClickedCopySettings: () => [
        { ...model, settingsCopied: false, settingsError: null },
        [
          CopySettings({
            text: `${JSON.stringify(model.clientConfigOverrides, null, 2)}\n`,
          }),
        ],
      ],
      GotListboxMessage: ({ target, message }) => {
        const current =
          target === 'transcript'
            ? model.transcriptListbox
            : target === 'scenario'
              ? model.scenarioListbox
              : target === 'compact-start'
                ? model.compactStartListbox
                : target === 'compact-end'
                  ? model.compactEndListbox
                  : model.toolListboxes[target]
        if (current === undefined) return noCommand(model)
        const result = StringListbox.update(current, message)
        const next =
          target === 'transcript'
            ? { ...model, transcriptListbox: result[0] }
            : target === 'scenario'
              ? { ...model, scenarioListbox: result[0] }
              : target === 'compact-start'
                ? { ...model, compactStartListbox: result[0] }
                : target === 'compact-end'
                  ? { ...model, compactEndListbox: result[0] }
                  : {
                      ...model,
                      toolListboxes: {
                        ...model.toolListboxes,
                        [target]: result[0],
                      },
                    }
        const commands = Command.mapMessages(result[1], (child) =>
          GotListboxMessage({ target, message: child })
        )
        const out = Option.getOrUndefined(result[2])
        if (out === undefined) return [next, commands]
        const [selected, selectedCommands] =
          target === 'transcript'
            ? update(
                next,
                SelectedTranscriptMode({
                  value: out.value === 'raw' ? 'raw' : 'pretty',
                })
              )
            : target === 'scenario'
              ? update(
                  next,
                  SelectedDevScenario({
                    id:
                      next.devScenarios?.scenarios.find(
                        (item) => item.id === out.value
                      )?.id ?? null,
                  })
                )
              : target === 'compact-start'
                ? update(next, SelectedCompactStart({ id: out.value }))
                : target === 'compact-end'
                  ? update(next, SelectedCompactEnd({ id: out.value }))
                  : update(
                      next,
                      SelectedToolPreference({
                        tool: target,
                        value:
                          out.value === 'expanded' || out.value === 'collapsed'
                            ? out.value
                            : 'default',
                      })
                    )
        return [selected, [...commands, ...selectedCommands]]
      },
      StartedResize: ({ target, x, viewportWidth }) =>
        noCommand({
          ...model,
          viewportWidth,
          resizing: {
            target,
            startX: x,
            startWidth:
              target === 'sidebar' ? model.sidebarWidth : model.treePanelWidth,
          },
        }),
      MovedResize: ({ x }) =>
        model.resizing === null
          ? noCommand(model)
          : noCommand(
              model.resizing.target === 'sidebar'
                ? {
                    ...model,
                    sidebarWidth: clampSidebarWidth(
                      model.resizing.startWidth + x - model.resizing.startX,
                      model.viewportWidth
                    ),
                  }
                : {
                    ...model,
                    treePanelWidth: clampTreePanelWidth(
                      model.resizing.startWidth - (x - model.resizing.startX),
                      model.viewportWidth
                    ),
                  }
            ),
      EndedResize: () =>
        model.resizing === null
          ? noCommand(model)
          : [
              { ...model, resizing: null },
              [
                SaveLayout({
                  sidebarWidth: model.sidebarWidth,
                  treePanelWidth: model.treePanelWidth,
                  treePanelOpen: model.treePanelOpen,
                  groupAgentSteps: model.groupAgentSteps,
                }),
              ],
            ],
      ViewportResized: ({ width }) =>
        noCommand({
          ...model,
          viewportWidth: width,
          sidebarWidth: clampSidebarWidth(model.sidebarWidth, width),
          treePanelWidth: clampTreePanelWidth(model.treePanelWidth, width),
        }),
      PointerInteractionsEnded: () => {
        const [ended, commands] = update(model, EndedResize())
        return [{ ...ended, compactDragStartNodeId: null }, commands]
      },
      HydratedBrowserState: ({
        overrides,
        settings,
        sidebarWidth,
        treePanelWidth,
        treePanelOpen,
        groupAgentSteps,
        viewportWidth,
      }) =>
        noCommand({
          ...model,
          clientConfigOverrides: overrides,
          clientSettings: settings,
          sidebarWidth,
          treePanelWidth,
          treePanelOpen,
          groupAgentSteps,
          viewportWidth,
        }),
      SavedSettings: ({ revision }) =>
        revision < model.settingsRevision
          ? noCommand(model)
          : noCommand({
              ...model,
              savedSettingsRevision: revision,
              settingsSaving: false,
            }),
      PersistedLayout: () => noCommand(model),
      CopiedSettings: () => noCommand({ ...model, settingsCopied: true }),
      FailedSavingSettings: ({
        revision,
        error,
        rollbackOverrides,
        rollbackSettings,
        wasReset,
      }) =>
        revision !== model.settingsRevision
          ? noCommand(model)
          : noCommand({
              ...model,
              clientConfigOverrides: rollbackOverrides,
              clientSettings: rollbackSettings,
              settingsSaving: false,
              settingsResetConfirm: wasReset,
              settingsError: error,
            }),
      FailedCopyingSettings: ({ error }) =>
        noCommand({
          ...model,
          settingsCopied: false,
          settingsError: error,
        }),
      LoadedHandshake: ({ baseUrl, version, tools }) =>
        baseUrl !== model.baseUrl
          ? noCommand(model)
          : noCommand({
              ...model,
              serverVersion: version,
              serverTools: tools,
              handshakeLoading: false,
              toolListboxes: Object.fromEntries(
                [
                  ...new Set([
                    ...tools.map((tool) => tool.name),
                    ...Object.keys(
                      model.clientSettings.toolBlockExpansion.tools
                    ),
                  ]),
                ].map((name) => [
                  name,
                  model.toolListboxes[name] ??
                    Listbox.init({ id: `tool-${name}` }),
                ])
              ),
            }),
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
                selectedRunId: null,
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
              selectedRunId: run.runId,
            }),
      StoppedRun: ({ baseUrl, runId }) =>
        baseUrl !== model.baseUrl || runId !== model.stoppingRunId
          ? noCommand(model)
          : noCommand(model),
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
              selectedRunId: run.runId,
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
              selectedRunId: run.runId,
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
              stoppingRunId:
                operation === 'stop run' ? null : model.stoppingRunId,
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
  switch (event._tag) {
    case 'TextDelta':
    case 'ReasoningDelta':
    case 'ToolCall':
    case 'ToolResult':
      if (model.selectedSessionId !== event.sessionId) return noCommand(model)
      if (event.eventId <= (model.contentWatermarks[event.runId] ?? 0))
        return noCommand(model)
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
      const contentWatermarks =
        event.contentThroughEventId === undefined
          ? model.contentWatermarks
          : {
              ...model.contentWatermarks,
              [event.runId]: Math.max(
                model.contentWatermarks[event.runId] ?? 0,
                event.contentThroughEventId
              ),
            }
      const acknowledgedThrough = contentWatermarks[event.runId]
      const reconcile = (activity: Model['activity'], runId: string | null) =>
        event.runId === runId && acknowledgedThrough !== undefined
          ? acknowledgeActivityThrough(activity, acknowledgedThrough)
          : activity
      const sessions = model.sessions.map((session) => {
        if (session.id !== event.sessionId) return session
        const lastUserMessageAt = event.nodes.reduce<number | null>(
          (latest, node) =>
            node.encoded.role === 'user' &&
            (latest === null || node.createdAt > latest)
              ? node.createdAt
              : latest,
          null
        )
        return {
          ...session,
          updatedAt: event.sessionUpdatedAt,
          lastUserMessageAt: lastUserMessageAt ?? session.lastUserMessageAt,
        }
      })
      if (
        model.selectedSessionId !== event.sessionId ||
        event.sequence <= model.sequence
      )
        return noCommand({
          ...model,
          sessions,
          contentWatermarks,
          selectedBaseNodeId:
            model.selectedSessionId === event.sessionId &&
            model.selectedRunId === event.runId &&
            model.nodes.some((node) => node.id === event.headNodeId)
              ? event.headNodeId
              : model.selectedBaseNodeId,
          activity: reconcile(model.activity, model.activeRunId),
          compactionActivity: reconcile(
            model.compactionActivity,
            model.compactingRunId
          ),
        })
      const nodes = new Map(model.nodes.map((node) => [node.id, node]))
      for (const node of event.nodes) nodes.set(node.id, node)
      return noCommand({
        ...model,
        sessions,
        contentWatermarks,
        nodes: [...nodes.values()],
        activity: reconcile(model.activity, model.activeRunId),
        compactionActivity: reconcile(
          model.compactionActivity,
          model.compactingRunId
        ),
        selectedBaseNodeId:
          model.selectedRunId === event.runId
            ? event.headNodeId
            : model.selectedBaseNodeId,
        sequence: event.sequence,
      })
    }
    case 'RunStart':
      if (model.selectedSessionId !== event.sessionId) return noCommand(model)
      if (event.visibility === 'background') return noCommand(model)
      return noCommand({
        ...model,
        activeRunId: event.runId,
        selectedRunId:
          model.startingSessionId !== null ? event.runId : model.selectedRunId,
        startingSessionId: null,
        activity: model.activeRunId === event.runId ? model.activity : [],
      })
    case 'RunEnd':
      const endedSessions = model.sessions.map((session) => {
        if (session.id !== event.sessionId) return session
        const activeRuns = (session.activeRuns ?? []).filter(
          (run) => run.runId !== event.runId
        )
        const status: SessionResponse['status'] =
          activeRuns.length === 0 ? 'idle' : 'running'
        return {
          ...session,
          activeRuns,
          status,
        }
      })
      const terminalModel = {
        ...model,
        sessions: endedSessions,
        stoppingRunId:
          model.stoppingRunId === event.runId ? null : model.stoppingRunId,
        compactingRunId:
          model.compactingRunId === event.runId ? null : model.compactingRunId,
        compactionActivity:
          model.compactingRunId === event.runId ? [] : model.compactionActivity,
      }
      if (model.selectedSessionId !== event.sessionId) {
        return noCommand({
          ...terminalModel,
        })
      }
      if (event.runId === model.compactingRunId) {
        return model.selectedSessionId === null
          ? noCommand(model)
          : [
              {
                ...terminalModel,
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
        return noCommand(terminalModel)
      }
      return model.selectedSessionId === null
        ? noCommand(model)
        : [
            {
              ...terminalModel,
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
          error:
            model.selectedSessionId === event.sessionId
              ? event.message
              : model.error,
        })
      return event.runId !== model.activeRunId ||
        model.selectedSessionId !== event.sessionId
        ? noCommand(model)
        : [
            { ...model, error: event.message },
            [
              LoadTranscript({
                baseUrl: model.baseUrl,
                sessionId: event.sessionId,
              }),
            ],
          ]
    case 'ReplayReset':
      return model.selectedSessionId !== event.sessionId
        ? noCommand(model)
        : [
            event.runId === model.activeRunId
              ? { ...model, activity: [] }
              : event.runId === model.compactingRunId
                ? { ...model, compactionActivity: [] }
                : model,
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
        sequence:
          model.selectedSessionId === event.sessionId
            ? Math.max(model.sequence, event.sequence)
            : model.sequence,
      })
    case 'ActiveRunUpserted':
      return noCommand({
        ...model,
        sessions: model.sessions.map((session) =>
          session.id !== event.sessionId
            ? session
            : {
                ...session,
                status: 'running',
                activeRuns: [
                  ...(session.activeRuns ?? []).filter(
                    (run) => run.runId !== event.runId
                  ),
                  {
                    sessionId: event.sessionId,
                    runId: event.runId,
                    baseNodeId: event.baseNodeId,
                    kind: event.kind,
                    visibility: event.visibility,
                    ...(event.title === undefined
                      ? {}
                      : { title: event.title }),
                    ...(event.parentRunId === undefined
                      ? {}
                      : { parentRunId: event.parentRunId }),
                    ...(event.toolCallId === undefined
                      ? {}
                      : { toolCallId: event.toolCallId }),
                  },
                ],
              }
        ),
        activeRunId:
          event.visibility === 'primary' &&
          model.selectedSessionId === event.sessionId
            ? event.runId
            : model.activeRunId,
        sequence:
          model.selectedSessionId === event.sessionId
            ? Math.max(model.sequence, event.sequence)
            : model.sequence,
      })
    case 'RunBaseUpdated':
      return event.runId !== model.activeRunId ||
        model.selectedSessionId !== event.sessionId ||
        model.selectedRunId !== event.runId
        ? noCommand(model)
        : noCommand({ ...model, selectedBaseNodeId: event.baseNodeId })
    case 'RunRetrying':
      return model.selectedSessionId !== event.sessionId
        ? noCommand(model)
        : noCommand({ ...model, error: `${event.title}: ${event.message}` })
  }
}

export const application = { Model, init, update, view, subscriptions }
