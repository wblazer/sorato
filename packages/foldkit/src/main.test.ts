import {
  DevScenario,
  DevScenariosStatus,
  MessageNodeResponse,
  ModelOption,
  ProjectResponse,
  SessionResponse,
  ToolInfo,
} from '@sorato/api'
import * as Combobox from '@foldkit/ui/combobox'
import * as Dialog from '@foldkit/ui/dialog'
import * as Listbox from '@foldkit/ui/listbox'
import * as Tabs from '@foldkit/ui/tabs'
import * as Scene from 'foldkit/scene'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  ActivateDevScenario,
  CompactRange,
  CreateSessionAndStartRun,
  DevScenariosUnavailable,
  FailedRequest,
  LoadDevScenarios,
  LoadHandshake,
  LoadModels,
  LoadTranscript,
  LoadWorkspace,
  LoadedDevScenarios,
  LoadedHandshake,
  LoadedModels,
  LoadedTranscript,
  LoadedWorkspace,
  StartRun,
  StartedCompaction,
  StartedNewSession,
  StartedRun,
  StoppedRun,
} from './api.ts'
import {
  FailedSavingSettings,
  PointerInteractionsEnded,
  PersistedLayout,
  SavedSettings,
  SaveLayout,
  SaveSettings,
  ViewportResized,
  saveSettingsToStorage,
} from './browser.ts'
import type { StorageLike } from './storage.ts'
import { ReceivedServerEvent } from './events.ts'
import {
  AdjustedTreeCompactRange,
  ClickedConnect,
  ClickedNewTab,
  ClickedStop,
  ChangedSetting,
  ConfirmedResetSettings,
  ClosedTab,
  ClickedRunScenario,
  Model,
  MovedResize,
  SelectedBaseNode,
  SelectedDevScenario,
  SelectedSession,
  SelectedTab,
  StartedResize,
  EndedResize,
  initialModel,
  update,
} from './main.ts'
import { view } from './view.ts'

const project = ProjectResponse.make({
  id: 'p1',
  name: 'Sorato',
  path: '/work/sorato',
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
})
const session = SessionResponse.make({
  id: 's1',
  projectId: 'p1',
  title: 'Foldkit rewrite',
  status: 'idle',
  archivedAt: null,
  lastUserMessageAt: null,
  createdAt: 1,
  updatedAt: 1,
})
const modelOption = ModelOption.make({
  id: 'provider/model',
  name: 'Model',
  provider: 'provider',
  capabilities: {
    attachment: false,
    reasoning: true,
    temperature: false,
    toolCall: true,
    thinkingLevels: ['high'],
    modes: [],
    limits: { context: 1000, output: 100 },
  },
})
const alternateModelOption = ModelOption.make({
  ...modelOption,
  id: 'provider/alternate',
  name: 'Alternate',
})
const alternateProject = ProjectResponse.make({
  ...project,
  id: 'p2',
  name: 'Example',
  path: '/work/example',
})
const toolInfo = ToolInfo.make({ name: 'Read', displayName: 'Read file' })
const loadedHandshake = LoadedHandshake({
  baseUrl: initialModel.baseUrl,
  version: '0.0.1-test',
  tools: [toolInfo],
})
const devScenarios = DevScenariosStatus.make({
  enabled: true,
  activeScenario: null,
  scenarios: [
    DevScenario.make({
      id: 'streaming',
      label: 'Streaming response',
      description: 'Streams deterministic chunks.',
      tags: ['streaming'],
      capabilities: ['text'],
    }),
    DevScenario.make({
      id: 'interruptible',
      label: 'Interruptible stream',
      description: 'Long enough to stop from the UI.',
      tags: ['cancellation'],
      capabilities: ['text'],
    }),
  ],
})
const messageNode = (id: string, role: 'user' | 'assistant') =>
  MessageNodeResponse.make({
    id,
    sessionId: 's1',
    parentId: id === 'n1' ? null : 'n1',
    kind: 'message',
    messageId: id,
    summaryId: null,
    sourceNodeId: null,
    runId: 'r0',
    run: null,
    modelCall: null,
    encoded: { role, content: role === 'user' ? 'Question' : 'Answer' },
    createdAt: 1,
  })
const systemNode = MessageNodeResponse.make({
  ...messageNode('n1', 'user'),
  encoded: { role: 'system', content: 'System instructions' },
})
const ready = (overrides: Partial<Model> = {}): Model =>
  Model.make({
    ...initialModel,
    status: 'ready',
    projects: [project],
    sessions: [session],
    ...overrides,
  })
const app = { update, view }

const resolveComboboxPreventBlurMounts = <Model, Message, OutMessage>(
  simulation: Scene.SceneSimulation<Model, Message, OutMessage>
): Scene.SceneSimulation<Model, Message, OutMessage> => {
  let resolved = simulation
  const pending = simulation.mounts.filter(
    (mount) => mount.name === Combobox.AttachComboboxPreventBlur.name
  )
  for (const mount of pending) {
    resolved = Scene.Mount.resolve(
      mount,
      Combobox.CompletedAttachComboboxPreventBlur()
    )(resolved)
  }
  return resolved
}

const givenWithComboboxMounts = <Model>(model: Model) =>
  [Scene.given(model), resolveComboboxPreventBlurMounts] as const

describe('Sorato scene', () => {
  it('reports authoritative settings storage failures', async () => {
    const broken: StorageLike = {
      length: 0,
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => undefined,
      key: () => null,
    }
    const result = await Effect.runPromise(
      saveSettingsToStorage(broken, {
        revision: 1,
        overrides: {},
        rollbackOverrides: {},
        rollbackSettings: initialModel.clientSettings,
        wasReset: false,
      })
    )
    expect(result._tag).toBe('FailedSavingSettings')
  })

  it('keeps connection settings separate from client settings', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready()),
      Scene.click(Scene.role('button', { name: 'Settings' })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.expect(Scene.text('General')).toExist(),
      Scene.expect(Scene.label('Server URL')).not.toExist(),
      Scene.expect(Scene.role('button', { name: 'Reconnect' })).not.toExist()
    )
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready()),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.expect(Scene.text('Connection settings')).toExist(),
      Scene.expect(Scene.label('Server URL')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Reconnect' })).toExist()
    )
  })

  it('persists optimistic settings by revision and resize layout only on end', () => {
    const [saving, saveCommands] = update(
      ready(),
      ChangedSetting({ setting: 'system', value: true })
    )
    expect(saving.clientSettings.expandSystemMessagesByDefault).toBe(true)
    expect(saving.settingsRevision).toBe(1)
    expect(saving.settingsSaving).toBe(true)
    expect(saveCommands[0]?.name).toBe(SaveSettings.name)

    const [newer] = update(
      saving,
      ChangedSetting({ setting: 'tool-default', value: true })
    )
    const [stillSaving] = update(newer, SavedSettings({ revision: 1 }))
    expect(stillSaving.settingsSaving).toBe(true)
    const [reset, resetCommands] = update(stillSaving, ConfirmedResetSettings())
    expect(reset.clientSettings).toEqual(initialModel.clientSettings)
    expect(reset.clientConfigOverrides).toEqual({})
    expect(resetCommands[0]?.name).toBe(SaveSettings.name)

    const [started] = update(
      ready({ sidebarWidth: 288 }),
      StartedResize({ target: 'sidebar', x: 300, viewportWidth: 1440 })
    )
    const [moved, moveCommands] = update(started, MovedResize({ x: 340 }))
    expect(moved.sidebarWidth).toBe(328)
    expect(moveCommands).toHaveLength(0)
    const [ended, layoutCommands] = update(moved, EndedResize())
    expect(ended.resizing).toBeNull()
    expect(layoutCommands[0]?.name).toBe(SaveLayout.name)

    const [treeStarted] = update(
      ready({ treePanelWidth: 360 }),
      StartedResize({ target: 'tree', x: 900, viewportWidth: 1440 })
    )
    const [treeMoved] = update(treeStarted, MovedResize({ x: 940 }))
    expect(treeMoved.treePanelWidth).toBe(320)

    const [cancelled, cancelCommands] = update(
      treeMoved,
      PointerInteractionsEnded()
    )
    expect(cancelled.resizing).toBeNull()
    expect(cancelCommands[0]?.name).toBe(SaveLayout.name)

    const [resized] = update(
      ready({ sidebarWidth: 500, treePanelWidth: 1000 }),
      ViewportResized({ width: 800 })
    )
    expect(resized.viewportWidth).toBe(800)
    expect(resized.sidebarWidth).toBe(360)
    expect(resized.treePanelWidth).toBe(600)

    const [failed] = update(
      saving,
      FailedSavingSettings({
        revision: 1,
        error: 'storage unavailable',
        rollbackOverrides: {},
        rollbackSettings: initialModel.clientSettings,
        wasReset: false,
      })
    )
    expect(failed.settingsSaving).toBe(false)
    expect(failed.settingsError).toContain('storage unavailable')

    const [resetting] = update(saving, ConfirmedResetSettings())
    const [resetFailed] = update(
      resetting,
      FailedSavingSettings({
        revision: resetting.settingsRevision,
        error: 'reset unavailable',
        rollbackOverrides: saving.clientConfigOverrides,
        rollbackSettings: saving.clientSettings,
        wasReset: true,
      })
    )
    expect(resetFailed.clientSettings).toEqual(saving.clientSettings)
    expect(resetFailed.settingsResetConfirm).toBe(true)
  })

  it('creates, selects, opens, and closes independent tabs', () => {
    const [withNewTab] = update(
      ready({ selectedProjectId: 'p1' }),
      ClickedNewTab()
    )
    expect(withNewTab.tabs).toHaveLength(2)
    expect(withNewTab.activeTabId).toBe('tab-1')

    const [selectedFirst] = update(withNewTab, SelectedTab({ id: 'tab-0' }))
    expect(selectedFirst.activeTabId).toBe('tab-0')

    const [withSession, commands] = update(
      { ...selectedFirst, overlay: 'search', sessionSearch: 'Foldkit' },
      SelectedSession({ id: 's1' })
    )
    expect(
      withSession.tabs.find((tab) => tab.id === withSession.activeTabId)
        ?.sessionId
    ).toBe('s1')
    expect(withSession.overlay).toBeNull()
    expect(withSession.sessionSearch).toBe('')
    expect(commands.some((command) => command.name === 'LoadTranscript')).toBe(
      true
    )

    const [closed] = update(withSession, ClosedTab({ id: 'tab-0' }))
    expect(closed.tabs).toHaveLength(1)
    expect(closed.activeTabId).toBe('tab-1')
  })

  it('resets open tabs when reconnecting', () => {
    const [reconnecting, commands] = update(
      ready({
        selectedSessionId: 's1',
        tabs: [
          { id: 'tab-0', sessionId: 's1', projectId: 'p1' },
          { id: 'tab-1', sessionId: null, projectId: 'p1' },
        ],
        activeTabId: 'tab-0',
        nextTabId: 2,
      }),
      ClickedConnect()
    )
    expect(reconnecting.tabs).toEqual([
      { id: 'tab-2', sessionId: null, projectId: null },
    ])
    expect(reconnecting.activeTabId).toBe('tab-2')
    expect(commands.map((command) => command.name)).toEqual([
      'LoadWorkspace',
      'LoadDevScenarios',
      'LoadHandshake',
    ])
  })

  it('keeps compaction endpoints on the selected branch ancestry', () => {
    const sibling = MessageNodeResponse.make({
      ...messageNode('n2', 'assistant'),
      id: 'sibling',
      messageId: 'sibling',
      encoded: { role: 'assistant', content: 'Sibling answer' },
    })
    const branch = MessageNodeResponse.make({
      ...messageNode('n2', 'assistant'),
      id: 'branch',
      messageId: 'branch',
      encoded: { role: 'assistant', content: 'Branch answer' },
    })
    const [loaded] = update(
      ready({
        selectedProjectId: 'p1',
        selectedSessionId: 's1',
        selectedBaseNodeId: 'sibling',
      }),
      LoadedTranscript({
        baseUrl: initialModel.baseUrl,
        sessionId: 's1',
        snapshot: {
          sequence: 2,
          nodes: [messageNode('n1', 'user'), sibling, branch],
        },
      })
    )
    expect(loaded.compactEndNodeId).toBe('sibling')

    const [selectedBranch] = update(loaded, SelectedBaseNode({ id: 'branch' }))
    expect(selectedBranch.compactStartNodeId).toBe('n1')
    expect(selectedBranch.compactEndNodeId).toBe('branch')
    Scene.scene(
      app,
      ...givenWithComboboxMounts(selectedBranch),
      Scene.expect(Scene.text('Branch answer')).toExist(),
      // Sibling branches remain visible in the real tree. Compaction controls,
      // rather than tree visibility, are restricted to selected ancestry.
      Scene.expect(
        Scene.role('button', { name: /Select branch: Sibling answer/ })
      ).toExist()
    )
  })

  it('normalizes grouped compact endpoints for forward and reverse drags', () => {
    const assistant = messageNode('n2', 'assistant')
    const secondAssistant = MessageNodeResponse.make({
      ...messageNode('n2', 'assistant'),
      id: 'n3',
      parentId: 'n2',
      messageId: 'n3',
      encoded: { role: 'assistant', content: 'Second answer' },
    })
    const compacting = ready({
      selectedSessionId: 's1',
      selectedBaseNodeId: 'n3',
      nodes: [messageNode('n1', 'user'), assistant, secondAssistant],
    })

    const [reverseStarted] = update(
      compacting,
      AdjustedTreeCompactRange({
        startId: 'n2',
        endId: 'n3',
        phase: 'start',
      })
    )
    const [reverse] = update(
      reverseStarted,
      AdjustedTreeCompactRange({
        startId: 'n1',
        endId: 'n1',
        phase: 'move',
      })
    )
    expect(reverse.compactStartNodeId).toBe('n1')
    expect(reverse.compactEndNodeId).toBe('n3')

    const [forwardStarted] = update(
      compacting,
      AdjustedTreeCompactRange({
        startId: 'n1',
        endId: 'n1',
        phase: 'start',
      })
    )
    const [forward] = update(
      forwardStarted,
      AdjustedTreeCompactRange({
        startId: 'n2',
        endId: 'n3',
        phase: 'move',
      })
    )
    expect(forward.compactStartNodeId).toBe('n1')
    expect(forward.compactEndNodeId).toBe('n3')
  })

  it('auto-selects the first workspace project and scopes model loading', () => {
    const [loaded, commands] = update(
      initialModel,
      LoadedWorkspace({
        baseUrl: initialModel.baseUrl,
        projects: [project],
        sessions: [session],
      })
    )
    expect(loaded.selectedProjectId).toBe('p1')
    expect(commands[0]?.name).toBe('LoadModels')

    const [stale, staleCommands] = update(
      loaded,
      LoadedModels({
        baseUrl: 'http://stale.example',
        projectId: 'p1',
        models: [modelOption],
        defaultModel: modelOption.id,
      })
    )
    expect(stale).toBe(loaded)
    expect(staleCommands).toHaveLength(0)
  })

  it('creates a session before running a scenario when no session is selected', () => {
    const activeScenarios = DevScenariosStatus.make({
      ...devScenarios,
      activeScenario: 'streaming',
    })
    const [starting, commands] = update(
      ready({ selectedProjectId: 'p1', devScenarios: activeScenarios }),
      ClickedRunScenario()
    )
    expect(starting.startingSessionId).toBe('new')
    expect(commands[0]?.name).toBe('CreateSessionAndStartRun')
    expect(commands[0]?.args).toMatchObject({
      projectId: 'p1',
      model: 'mock/streaming-demo',
    })
  })

  it('isolates compaction activity and surfaces background summary failure', () => {
    const running = ready({
      selectedProjectId: 'p1',
      selectedSessionId: 's1',
      activeRunId: 'primary',
      compactingRunId: 'summary',
    })
    const [streaming] = update(
      running,
      ReceivedServerEvent({
        event: {
          _tag: 'TextDelta',
          sessionId: 's1',
          runId: 'summary',
          delta: 'summary text',
          eventId: 1,
        },
      })
    )
    expect(streaming.activity).toHaveLength(0)
    expect(streaming.compactionActivity[0]?.body).toBe('summary text')

    const [failed] = update(
      streaming,
      ReceivedServerEvent({
        event: {
          _tag: 'RunFailed',
          sessionId: 's1',
          runId: 'summary',
          message: 'summary failed',
        },
      })
    )
    expect(failed.compactingRunId).toBeNull()
    expect(failed.compactionActivity).toHaveLength(0)
    expect(failed.activeRunId).toBe('primary')
    expect(failed.error).toBe('summary failed')
  })

  it('refreshes canonical transcript batches, dedupes sequence, and preserves the head', () => {
    const selected = ready({
      selectedProjectId: 'p1',
      selectedSessionId: 's1',
      selectedBaseNodeId: 'n1',
      selectedRunId: 'r1',
      nodes: [messageNode('n1', 'user')],
      sequence: 3,
    })
    const committed = ReceivedServerEvent({
      event: {
        _tag: 'NodeBatchCommitted',
        sequence: 4,
        sessionId: 's1',
        runId: 'r1',
        nodes: [messageNode('n2', 'assistant')],
        headNodeId: 'n2',
        sessionUpdatedAt: 2,
      },
    })
    const [refreshing, commands] = update(selected, committed)
    expect(refreshing.nodes.map((node) => node.id)).toEqual(['n1', 'n2'])
    expect(refreshing.selectedBaseNodeId).toBe('n2')
    expect(commands).toHaveLength(0)
    const [, duplicateCommands] = update(refreshing, committed)
    expect(duplicateCommands).toHaveLength(0)

    const [canonical] = update(
      refreshing,
      LoadedTranscript({
        baseUrl: initialModel.baseUrl,
        sessionId: 's1',
        snapshot: {
          sequence: 4,
          nodes: [messageNode('n1', 'user'), messageNode('n2', 'assistant')],
        },
      })
    )
    expect(canonical.selectedBaseNodeId).toBe('n2')
  })

  it('retains durable content watermarks across stream ordering and selection', () => {
    const background = ready({
      selectedSessionId: 's1',
      activeRunId: 'selected-run',
      sequence: 3,
    })
    const [acknowledged] = update(
      background,
      ReceivedServerEvent({
        event: {
          _tag: 'NodeBatchCommitted',
          sequence: 1,
          sessionId: 's2',
          runId: 'background-run',
          nodes: [],
          headNodeId: 'n1',
          sessionUpdatedAt: 2,
          contentThroughEventId: 4,
        },
      })
    )
    expect(acknowledged.contentWatermarks['background-run']).toBe(4)

    const selected = {
      ...acknowledged,
      selectedSessionId: 's2',
      activeRunId: 'background-run',
      selectedRunId: 'background-run',
    }
    const [lateReplay] = update(
      selected,
      ReceivedServerEvent({
        event: {
          _tag: 'TextDelta',
          sessionId: 's2',
          runId: 'background-run',
          delta: 'already durable',
          eventId: 4,
        },
      })
    )
    expect(lateReplay.activity).toHaveLength(0)

    const [newContent] = update(
      lateReplay,
      ReceivedServerEvent({
        event: {
          _tag: 'TextDelta',
          sessionId: 's2',
          runId: 'background-run',
          delta: 'new',
          eventId: 5,
        },
      })
    )
    expect(newContent.activity[0]?.body).toBe('new')

    const [laterAcknowledgement] = update(
      newContent,
      ReceivedServerEvent({
        event: {
          _tag: 'NodeBatchCommitted',
          sequence: 4,
          sessionId: 's2',
          runId: 'background-run',
          nodes: [],
          headNodeId: 'n1',
          sessionUpdatedAt: 3,
          contentThroughEventId: 5,
        },
      })
    )
    expect(laterAcknowledgement.activity).toHaveLength(0)
    expect(laterAcknowledgement.contentWatermarks['background-run']).toBe(5)
  })

  it('does not let a run-stream end hide an earlier canonical node batch', () => {
    const running = ready({
      selectedProjectId: 'p1',
      selectedSessionId: 's1',
      activeRunId: 'r1',
      selectedRunId: 'r1',
      sequence: 3,
    })
    const [ended] = update(
      running,
      ReceivedServerEvent({
        event: {
          _tag: 'RunEnd',
          sequence: 5,
          sessionId: 's1',
          runId: 'r1',
        },
      })
    )
    expect(ended.sequence).toBe(3)

    const [committed, commands] = update(
      ended,
      ReceivedServerEvent({
        event: {
          _tag: 'NodeBatchCommitted',
          sequence: 4,
          sessionId: 's1',
          runId: 'r1',
          nodes: [messageNode('n2', 'assistant')],
          headNodeId: 'n2',
          sessionUpdatedAt: 2,
        },
      })
    )
    expect(committed.selectedBaseNodeId).toBe('n2')
    expect(committed.nodes.map((node) => node.id)).toEqual(['n2'])
    expect(commands).toHaveLength(0)
  })

  it('follows a committed run head after a newer transcript wins the stream race', () => {
    const running = ready({
      selectedSessionId: 's1',
      activeRunId: 'r1',
      selectedRunId: 'r1',
      selectedBaseNodeId: 'n1',
      nodes: [messageNode('n1', 'user')],
      sequence: 1,
    })
    const [ended] = update(
      running,
      ReceivedServerEvent({
        event: {
          _tag: 'RunEnd',
          sequence: 3,
          sessionId: 's1',
          runId: 'r1',
        },
      })
    )
    const [snapshotted] = update(
      ended,
      LoadedTranscript({
        baseUrl: initialModel.baseUrl,
        sessionId: 's1',
        snapshot: {
          sequence: 3,
          nodes: [messageNode('n1', 'user'), messageNode('n2', 'assistant')],
        },
      })
    )
    expect(snapshotted.selectedBaseNodeId).toBe('n1')

    const [committed] = update(
      snapshotted,
      ReceivedServerEvent({
        event: {
          _tag: 'NodeBatchCommitted',
          sequence: 2,
          sessionId: 's1',
          runId: 'r1',
          nodes: [messageNode('n2', 'assistant')],
          headNodeId: 'n2',
          sessionUpdatedAt: 2,
        },
      })
    )
    expect(committed.selectedBaseNodeId).toBe('n2')
  })

  it('does not move an explicitly selected branch when another run commits', () => {
    const selected = ready({
      selectedSessionId: 's1',
      activeRunId: 'active-run',
      selectedRunId: null,
      selectedBaseNodeId: 'historical-head',
      sequence: 1,
    })
    const [committed] = update(
      selected,
      ReceivedServerEvent({
        event: {
          _tag: 'NodeBatchCommitted',
          sequence: 2,
          sessionId: 's1',
          runId: 'active-run',
          nodes: [],
          headNodeId: 'active-head',
          sessionUpdatedAt: 2,
        },
      })
    )
    expect(committed.selectedBaseNodeId).toBe('historical-head')
    expect(committed.selectedRunId).toBeNull()

    const [baseUpdated] = update(
      selected,
      ReceivedServerEvent({
        event: {
          _tag: 'RunBaseUpdated',
          sessionId: 's1',
          runId: 'active-run',
          baseNodeId: 'active-base',
        },
      })
    )
    expect(baseUpdated.selectedBaseNodeId).toBe('historical-head')
  })

  it('leaves completion to RunEnd for either stop response ordering', () => {
    const running = ready({
      selectedSessionId: 's1',
      activeRunId: 'r1',
    })
    const [stopping] = update(running, ClickedStop())
    expect(stopping.stoppingRunId).toBe('r1')

    const [httpFirst] = update(
      stopping,
      StoppedRun({
        baseUrl: initialModel.baseUrl,
        runId: 'r1',
        status: { status: 'stopped' },
      })
    )
    expect(httpFirst.activeRunId).toBe('r1')
    const [sseAfter] = update(
      httpFirst,
      ReceivedServerEvent({
        event: { _tag: 'RunEnd', sequence: 2, sessionId: 's1', runId: 'r1' },
      })
    )
    expect(sseAfter.activeRunId).toBeNull()
    expect(sseAfter.stoppingRunId).toBeNull()

    const [sseFirst] = update(
      stopping,
      ReceivedServerEvent({
        event: { _tag: 'RunEnd', sequence: 2, sessionId: 's1', runId: 'r1' },
      })
    )
    const [lateHttp] = update(
      sseFirst,
      StoppedRun({
        baseUrl: initialModel.baseUrl,
        runId: 'r1',
        status: { status: 'stopped' },
      })
    )
    expect(lateHttp.activeRunId).toBeNull()
    expect(lateHttp.stoppingRunId).toBeNull()

    const [requestFailed] = update(
      stopping,
      FailedRequest({
        baseUrl: initialModel.baseUrl,
        operation: 'stop run',
        error: 'offline',
      })
    )
    expect(requestFailed.stoppingRunId).toBeNull()
  })

  it('updates lifecycle metadata for a non-selected session only', () => {
    const backgroundSession = SessionResponse.make({ ...session, id: 's2' })
    const selected = ready({
      selectedSessionId: 's1',
      activeRunId: 'selected-run',
      sessions: [session, backgroundSession],
    })
    const [started] = update(
      selected,
      ReceivedServerEvent({
        event: {
          _tag: 'ActiveRunUpserted',
          sequence: 9,
          sessionId: 's2',
          runId: 'background-run',
          baseNodeId: null,
          kind: 'summary',
          visibility: 'background',
        },
      })
    )
    expect(started.activeRunId).toBe('selected-run')
    expect(started.sequence).toBe(selected.sequence)
    expect(started.sessions[1]?.status).toBe('running')
    expect(started.sessions[1]?.activeRuns?.[0]?.runId).toBe('background-run')

    const [ended] = update(
      started,
      ReceivedServerEvent({
        event: {
          _tag: 'RunEnd',
          sequence: 10,
          sessionId: 's2',
          runId: 'background-run',
        },
      })
    )
    expect(ended.activeRunId).toBe('selected-run')
    expect(ended.sessions[1]?.status).toBe('idle')

    const [backgroundCompactionEnded] = update(
      { ...started, compactingRunId: 'background-run' },
      ReceivedServerEvent({
        event: {
          _tag: 'RunEnd',
          sequence: 10,
          sessionId: 's2',
          runId: 'background-run',
        },
      })
    )
    expect(backgroundCompactionEnded.compactingRunId).toBeNull()
  })

  it('guards scenario changes during run startup, primary runs, and compaction', () => {
    for (const state of [
      { startingSessionId: 's1' },
      { activeRunId: 'r1' },
      { compactingRunId: 'summary' },
    ]) {
      const model = ready({ devScenarios, ...state })
      const [unchanged, commands] = update(
        model,
        SelectedDevScenario({ id: 'streaming' })
      )
      expect(unchanged).toBe(model)
      expect(commands).toHaveLength(0)
    }
  })

  it('shows loading and resolves initial workspace loading', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(initialModel),
      Scene.expect(Scene.role('button', { name: /Connection:/ })).toExist(),
      Scene.Command.expectNone()
    )
    Scene.scene(
      app,
      ...givenWithComboboxMounts({ ...initialModel, status: 'ready' }),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.click(Scene.role('button', { name: 'Reconnect' })),
      Scene.Command.resolve(
        LoadWorkspace,
        LoadedWorkspace({
          baseUrl: initialModel.baseUrl,
          projects: [project],
          sessions: [session],
        })
      ),
      Scene.Command.resolve(
        LoadDevScenarios,
        DevScenariosUnavailable({ baseUrl: initialModel.baseUrl })
      ),
      Scene.Command.resolve(LoadHandshake, loadedHandshake),
      Scene.Command.resolve(
        LoadModels,
        LoadedModels({
          baseUrl: initialModel.baseUrl,
          projectId: 'p1',
          models: [modelOption],
          defaultModel: modelOption.id,
        })
      ),
      Scene.expect(Scene.text('New Session')).toExist()
    )
  })

  it('selects a project and session through command resolution', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready({ selectedProjectId: 'p1' })),
      Scene.click(Scene.role('button', { name: /Foldkit rewrite/ })),
      Scene.Command.expectHas(LoadTranscript),
      Scene.Command.resolve(
        LoadTranscript,
        LoadedTranscript({
          baseUrl: initialModel.baseUrl,
          sessionId: 's1',
          snapshot: { sequence: 1, nodes: [] },
        })
      ),
      Scene.expect(Scene.text('No messages yet.')).toExist(),
      Scene.Mount.expectEnded(Combobox.AttachComboboxPreventBlur)
    )
  })

  it('loads the owning project and its models when opening a session directly', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready()),
      Scene.click(Scene.role('button', { name: /Foldkit rewrite/ })),
      Scene.Command.expectHas(LoadTranscript),
      Scene.Command.expectHas(LoadModels),
      Scene.Command.resolve(
        LoadModels,
        LoadedModels({
          baseUrl: initialModel.baseUrl,
          projectId: 'p1',
          models: [modelOption],
          defaultModel: 'provider/model',
        })
      ),
      Scene.Command.resolve(
        LoadTranscript,
        LoadedTranscript({
          baseUrl: initialModel.baseUrl,
          sessionId: 's1',
          snapshot: { sequence: 1, nodes: [] },
        })
      ),
      Scene.expect(Scene.label('Prompt')).not.toBeDisabled(),
      Scene.Mount.expectEnded(Combobox.AttachComboboxPreventBlur)
    )
  })

  it('updates the draft, sends, and resolves a run', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedSessionId: 's1',
          selectedModelId: 'provider/model',
        })
      ),
      Scene.type(Scene.label('Prompt'), 'Implement it'),
      Scene.click(Scene.role('button', { name: 'Send message' })),
      Scene.Command.expectHas(StartRun),
      Scene.expect(Scene.label('Prompt')).toBeDisabled(),
      Scene.Command.resolve(
        StartRun,
        StartedRun({
          baseUrl: initialModel.baseUrl,
          sessionId: 's1',
          run: { status: 'started', runId: 'r1', baseNodeId: null },
        })
      ),
      Scene.expect(Scene.role('button', { name: 'Stop run' })).toExist()
    )
  })

  it('creates a session and starts its first run from a new tab', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedModelId: 'provider/model',
          models: [modelOption],
        })
      ),
      Scene.type(Scene.label('Prompt'), 'Start from scratch'),
      Scene.click(Scene.role('button', { name: 'Send message' })),
      Scene.Command.expectHas(CreateSessionAndStartRun),
      Scene.expect(Scene.label('Prompt')).toBeDisabled(),
      Scene.Command.resolve(
        CreateSessionAndStartRun,
        StartedNewSession({
          baseUrl: initialModel.baseUrl,
          session,
          run: { status: 'started', runId: 'r-new', baseNodeId: null },
        })
      ),
      Scene.expect(Scene.role('button', { name: 'Stop run' })).toExist(),
      Scene.expect(Scene.text('Foldkit rewrite')).toExist(),
      Scene.Mount.expectEnded(Combobox.AttachComboboxPreventBlur)
    )
  })

  it('sends on Enter and toggles the conversation side panel', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedSessionId: 's1',
          selectedModelId: 'provider/model',
        })
      ),
      Scene.type(Scene.label('Prompt'), 'Send with keyboard'),
      Scene.keydown(Scene.label('Prompt'), 'Enter', {}),
      Scene.Command.expectHas(StartRun),
      Scene.Command.resolve(
        StartRun,
        StartedRun({
          baseUrl: initialModel.baseUrl,
          sessionId: 's1',
          run: { status: 'started', runId: 'r1', baseNodeId: null },
        })
      ),
      Scene.click(Scene.role('button', { name: 'Close side panel' })),
      Scene.Command.resolve(SaveLayout, PersistedLayout()),
      Scene.expect(
        Scene.role('button', { name: 'Conversation tree' })
      ).not.toExist(),
      Scene.expect(Scene.role('button', { name: 'Open side panel' })).toExist()
    )
  })

  it('renders streamed text, reasoning, tool calls and results', () => {
    const streamModel = ready({
      selectedProjectId: 'p1',
      selectedSessionId: 's1',
      selectedModelId: 'provider/model',
      activeRunId: 'r1',
      selectedRunId: 'r1',
    })
    Scene.scene(
      app,
      ...givenWithComboboxMounts(streamModel),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'TextDelta',
            sessionId: 's1',
            runId: 'r1',
            delta: 'Hello ',
            eventId: 1,
          },
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'TextDelta',
            sessionId: 's1',
            runId: 'r1',
            delta: 'world',
            eventId: 2,
          },
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'ReasoningDelta',
            sessionId: 's1',
            runId: 'r1',
            delta: 'Thinking',
            eventId: 3,
          },
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'ToolCall',
            sessionId: 's1',
            runId: 'r1',
            id: 't1',
            name: 'read',
            params: { path: 'a.ts' },
            eventId: 4,
          },
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'ToolResult',
            sessionId: 's1',
            runId: 'r1',
            id: 't1',
            name: 'read',
            result: 'file body',
            isFailure: false,
            eventId: 5,
          },
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'RunStart',
            sessionId: 's1',
            runId: 'r1',
            baseNodeId: null,
            kind: 'agent',
            visibility: 'primary',
          },
        })
      ),
      Scene.expect(Scene.text('Hello world')).toExist(),
      Scene.expect(Scene.text('Thinking')).toExist(),
      Scene.expect(Scene.text('Tool call · read')).toExist(),
      Scene.expect(Scene.text('file body')).toExist()
    )
  })

  it('shows failures and keeps the composer disabled without a session', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready()),
      Scene.expect(Scene.label('Prompt')).toBeDisabled(),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.click(Scene.role('button', { name: 'Reconnect' })),
      Scene.Command.expectHas(LoadWorkspace),
      Scene.Command.resolve(
        LoadWorkspace,
        FailedRequest({
          baseUrl: initialModel.baseUrl,
          operation: 'load workspace',
          error: 'offline',
        })
      ),
      Scene.Command.resolve(
        LoadDevScenarios,
        DevScenariosUnavailable({ baseUrl: initialModel.baseUrl })
      ),
      Scene.Command.resolve(LoadHandshake, loadedHandshake),
      Scene.expect(Scene.role('alert')).toContainText('offline')
    )
  })

  it('keeps a primary run active when a background run completes', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedSessionId: 's1',
          selectedModelId: 'provider/model',
          activeRunId: 'primary',
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'ActiveRunUpserted',
            sequence: 2,
            sessionId: 's1',
            runId: 'summary',
            baseNodeId: null,
            kind: 'summary',
            visibility: 'background',
          },
        })
      ),
      Scene.Subscription.emit(
        ReceivedServerEvent({
          event: {
            _tag: 'RunEnd',
            sequence: 3,
            sessionId: 's1',
            runId: 'summary',
          },
        })
      ),
      Scene.expect(Scene.role('button', { name: 'Stop run' })).toExist()
    )
  })

  it('selects and runs a mock scenario entirely from the dev UI', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedSessionId: 's1',
          devScenarios,
        })
      ),
      Scene.click(Scene.role('button', { name: 'Scenario Lab' })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.click(Scene.label('Scenario')),
      Scene.Command.resolve(Listbox.FocusItems, Listbox.CompletedFocusItems()),
      Scene.Mount.resolve(
        Listbox.PortalListboxBackdrop,
        Listbox.CompletedPortalListboxBackdrop()
      ),
      Scene.Mount.resolve(
        Listbox.AnchorListbox,
        Listbox.CompletedAnchorListbox()
      ),
      Scene.keydown(Scene.role('listbox'), 'ArrowDown'),
      Scene.Command.resolve(
        Listbox.ScrollIntoView,
        Listbox.CompletedScrollIntoView()
      ),
      Scene.keydown(Scene.role('listbox'), 'ArrowDown'),
      Scene.Command.resolve(
        Listbox.ScrollIntoView,
        Listbox.CompletedScrollIntoView()
      ),
      Scene.keydown(Scene.role('listbox'), 'Enter'),
      Scene.Command.resolve(Listbox.ClickItem, Listbox.CompletedClickItem()),
      Scene.click(Scene.role('option', { name: 'Interruptible stream' })),
      Scene.Mount.expectEnded(
        Listbox.PortalListboxBackdrop,
        Listbox.AnchorListbox
      ),
      Scene.Command.resolve(
        Listbox.FocusButton,
        Listbox.CompletedFocusButton()
      ),
      Scene.Command.expectHas(ActivateDevScenario),
      Scene.Command.resolve(
        ActivateDevScenario,
        LoadedDevScenarios({
          baseUrl: initialModel.baseUrl,
          status: { ...devScenarios, activeScenario: 'interruptible' },
        })
      ),
      Scene.Command.resolve(
        LoadModels,
        LoadedModels({
          baseUrl: initialModel.baseUrl,
          projectId: 'p1',
          models: [modelOption],
          defaultModel: 'provider/model',
        })
      ),
      Scene.click(Scene.role('button', { name: 'Run selected scenario' })),
      Scene.Command.resolve(
        StartRun,
        StartedRun({
          baseUrl: initialModel.baseUrl,
          sessionId: 's1',
          run: { status: 'started', runId: 'r1', baseNodeId: null },
        })
      ),
      Scene.expect(Scene.role('button', { name: 'Stop scenario' })).toExist(),
      Scene.click(Scene.role('button', { name: 'Close dialog' })),
      Scene.Command.resolve(Dialog.CloseDialog, Dialog.CompletedCloseDialog()),
      Scene.expect(Scene.role('dialog')).not.toExist()
    )
  })

  it('hides the scenario lab when the server does not expose dev controls', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready({ devScenarios })),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.click(Scene.role('button', { name: 'Reconnect' })),
      Scene.Command.expectHas(LoadDevScenarios),
      Scene.Command.resolve(
        LoadDevScenarios,
        DevScenariosUnavailable({ baseUrl: initialModel.baseUrl })
      ),
      Scene.Command.resolve(
        LoadWorkspace,
        LoadedWorkspace({
          baseUrl: initialModel.baseUrl,
          projects: [project],
          sessions: [session],
        })
      ),
      Scene.Command.resolve(LoadHandshake, loadedHandshake),
      Scene.Command.resolve(
        LoadModels,
        LoadedModels({
          baseUrl: initialModel.baseUrl,
          projectId: 'p1',
          models: [modelOption],
          defaultModel: modelOption.id,
        })
      ),
      Scene.expect(Scene.text('Scenario Lab')).not.toExist()
    )
  })

  it('starts compaction from the selected transcript range', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedSessionId: 's1',
          selectedModelId: 'provider/model',
          selectedBaseNodeId: 'n2',
          nodes: [messageNode('n1', 'user'), messageNode('n2', 'assistant')],
          compactStartNodeId: 'n1',
          compactEndNodeId: 'n2',
          devScenarios,
        })
      ),
      Scene.click(Scene.role('button', { name: 'Scenario Lab' })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.click(Scene.role('button', { name: 'Summarize selected range' })),
      Scene.Command.expectHas(CompactRange),
      Scene.Command.resolve(
        CompactRange,
        StartedCompaction({
          baseUrl: initialModel.baseUrl,
          sessionId: 's1',
          run: { status: 'started', runId: 'summary-1', baseNodeId: 'n2' },
        })
      ),
      Scene.expect(Scene.text('Generating summary')).toExist()
    )
  })

  it('opens, filters, and keyboard-selects a model', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({
          selectedProjectId: 'p1',
          selectedModelId: modelOption.id,
          models: [modelOption, alternateModelOption],
        })
      ),
      Scene.click(Scene.role('button', { name: 'Model' })),
      Scene.Command.resolve(
        Combobox.FocusInput,
        Combobox.CompletedFocusInput()
      ),
      Scene.Mount.resolve(
        Combobox.PortalComboboxBackdrop,
        Combobox.CompletedPortalComboboxBackdrop()
      ),
      Scene.Mount.resolve(
        Combobox.AnchorCombobox,
        Combobox.CompletedAnchorCombobox()
      ),
      Scene.type(Scene.label('Model'), 'Alternate'),
      Scene.expect(Scene.role('option', { name: /Alternate/ })).toExist(),
      Scene.expect(Scene.role('option', { name: /^Model/ })).not.toExist(),
      Scene.keydown(Scene.label('Model'), 'ArrowDown'),
      Scene.Command.resolve(
        Combobox.ScrollIntoView,
        Combobox.CompletedScrollIntoView()
      ),
      Scene.keydown(Scene.label('Model'), 'Enter'),
      Scene.Command.resolve(Combobox.ClickItem, Combobox.CompletedClickItem()),
      Scene.click(Scene.role('option', { name: /Alternate/ })),
      Scene.Command.resolve(
        Combobox.FocusInput,
        Combobox.CompletedFocusInput()
      ),
      Scene.expect(Scene.label('Model')).toHaveValue('Alternate'),
      Scene.Mount.expectEnded(
        Combobox.PortalComboboxBackdrop,
        Combobox.AnchorCombobox
      )
    )
  })

  it('opens, filters, and keyboard-selects a project and queues model loading', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(
        ready({ projects: [project, alternateProject] })
      ),
      Scene.click(Scene.role('button', { name: 'Select project' })),
      Scene.Command.resolve(
        Combobox.FocusInput,
        Combobox.CompletedFocusInput()
      ),
      Scene.Mount.resolve(
        Combobox.PortalComboboxBackdrop,
        Combobox.CompletedPortalComboboxBackdrop()
      ),
      Scene.Mount.resolve(
        Combobox.AnchorCombobox,
        Combobox.CompletedAnchorCombobox()
      ),
      Scene.type(Scene.label('Project'), 'Example'),
      Scene.expect(Scene.text('/work/example')).toExist(),
      Scene.expect(Scene.text('/work/sorato')).not.toExist(),
      Scene.keydown(Scene.label('Project'), 'ArrowDown'),
      Scene.Command.resolve(
        Combobox.ScrollIntoView,
        Combobox.CompletedScrollIntoView()
      ),
      Scene.keydown(Scene.label('Project'), 'Enter'),
      Scene.Command.resolve(Combobox.ClickItem, Combobox.CompletedClickItem()),
      Scene.click(Scene.role('option', { name: /Example/ })),
      Scene.Command.resolve(
        Combobox.FocusInput,
        Combobox.CompletedFocusInput()
      ),
      Scene.Command.expectHas(LoadModels),
      Scene.Command.resolve(
        LoadModels,
        LoadedModels({
          baseUrl: initialModel.baseUrl,
          projectId: 'p2',
          models: [alternateModelOption],
          defaultModel: alternateModelOption.id,
        })
      ),
      Scene.expect(Scene.label('Project')).toHaveValue('Example'),
      Scene.Mount.expectEnded(
        Combobox.PortalComboboxBackdrop,
        Combobox.AnchorCombobox
      )
    )
  })

  it('uses roving keyboard selection for the side-panel tabs', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready()),
      Scene.expect(Scene.role('tab', { name: 'Tree' })).toHaveAttr(
        'aria-selected',
        'true'
      ),
      Scene.keydown(Scene.role('tab', { name: 'Tree' }), 'ArrowRight'),
      Scene.Command.resolve(Tabs.FocusTab, Tabs.CompletedFocusTab()),
      Scene.expect(Scene.role('tab', { name: 'Diff' })).toHaveAttr(
        'aria-selected',
        'true'
      ),
      Scene.expect(Scene.text('No file changes')).toExist()
    )
  })

  it('toggles disclosures with click, Enter, and Space', () => {
    const disclosed = ready({
      selectedSessionId: 's1',
      nodes: [systemNode],
      selectedBaseNodeId: 'n1',
    })
    Scene.scene(
      app,
      ...givenWithComboboxMounts(disclosed),
      Scene.click(Scene.role('button', { name: 'System Prompt' })),
      Scene.expect(Scene.text('System instructions')).toExist(),
      Scene.keydown(Scene.role('button', { name: 'System Prompt' }), 'Enter'),
      Scene.expect(Scene.role('button', { name: 'System Prompt' })).toHaveAttr(
        'aria-expanded',
        'false'
      ),
      Scene.keydown(Scene.role('button', { name: 'System Prompt' }), ' '),
      Scene.expect(Scene.role('button', { name: 'System Prompt' })).toHaveAttr(
        'aria-expanded',
        'true'
      )
    )
  })

  it('closes a dialog through its close control and updates the overlay', () => {
    Scene.scene(
      app,
      ...givenWithComboboxMounts(ready()),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
      Scene.Command.resolve(Dialog.ShowDialog, Dialog.CompletedShowDialog()),
      Scene.expect(Scene.role('dialog')).toExist(),
      Scene.click(Scene.role('button', { name: 'Close dialog' })),
      Scene.Command.resolve(Dialog.CloseDialog, Dialog.CompletedCloseDialog()),
      Scene.expect(Scene.role('dialog')).not.toExist(),
      Scene.expect(Scene.text('Connection settings')).not.toExist()
    )
  })
})
