import {
  DevScenario,
  DevScenariosStatus,
  MessageNodeResponse,
  ModelOption,
  ProjectResponse,
  SessionResponse,
} from '@sorato/api'
import * as Scene from 'foldkit/scene'
import { describe, expect, it } from 'vitest'
import {
  ActivateDevScenario,
  CompactRange,
  CreateSessionAndStartRun,
  DevScenariosUnavailable,
  FailedRequest,
  LoadDevScenarios,
  LoadModels,
  LoadTranscript,
  LoadWorkspace,
  LoadedDevScenarios,
  LoadedModels,
  LoadedTranscript,
  LoadedWorkspace,
  StartRun,
  StartedCompaction,
  StartedNewSession,
  StartedRun,
} from './api.ts'
import { ReceivedServerEvent } from './events.ts'
import {
  ClickedConnect,
  ClickedNewTab,
  ClosedTab,
  ClickedRunScenario,
  Model,
  SelectedBaseNode,
  SelectedDevScenario,
  SelectedSession,
  SelectedTab,
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
const ready = (overrides: Partial<Model> = {}): Model =>
  Model.make({
    ...initialModel,
    status: 'ready',
    projects: [project],
    sessions: [session],
    ...overrides,
  })
const app = { update, view }

describe('Sorato scene', () => {
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
      Scene.given(selectedBranch),
      Scene.expect(Scene.text('Branch answer')).toExist(),
      Scene.expect(Scene.text('Sibling answer')).not.toExist()
    )
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
    expect(refreshing.nodes.map((node) => node.id)).toEqual(['n1'])
    expect(refreshing.selectedBaseNodeId).toBe('n2')
    expect(commands[0]?.name).toBe('LoadTranscript')
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

  it('does not let a run-stream end hide an earlier canonical node batch', () => {
    const running = ready({
      selectedProjectId: 'p1',
      selectedSessionId: 's1',
      activeRunId: 'r1',
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
    expect(commands[0]?.name).toBe('LoadTranscript')
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
      Scene.given(initialModel),
      Scene.expect(Scene.role('button', { name: /Connection:/ })).toExist(),
      Scene.Command.expectNone()
    )
    Scene.scene(
      app,
      Scene.given({ ...initialModel, status: 'ready' }),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
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
      Scene.given(ready({ selectedProjectId: 'p1' })),
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
      Scene.expect(Scene.text('No messages yet.')).toExist()
    )
  })

  it('loads the owning project and its models when opening a session directly', () => {
    Scene.scene(
      app,
      Scene.given(ready()),
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
      Scene.expect(Scene.label('Prompt')).not.toBeDisabled()
    )
  })

  it('updates the draft, sends, and resolves a run', () => {
    Scene.scene(
      app,
      Scene.given(
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
      Scene.given(
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
      Scene.expect(Scene.text('Foldkit rewrite')).toExist()
    )
  })

  it('sends on Enter and toggles the conversation side panel', () => {
    Scene.scene(
      app,
      Scene.given(
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
    })
    Scene.scene(
      app,
      Scene.given(streamModel),
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
      Scene.given(ready()),
      Scene.expect(Scene.label('Prompt')).toBeDisabled(),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
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
      Scene.expect(Scene.role('alert')).toContainText('offline')
    )
  })

  it('keeps a primary run active when a background run completes', () => {
    Scene.scene(
      app,
      Scene.given(
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
      Scene.given(
        ready({
          selectedProjectId: 'p1',
          selectedSessionId: 's1',
          devScenarios,
        })
      ),
      Scene.click(Scene.role('button', { name: 'Scenario Lab' })),
      Scene.change(Scene.label('Scenario'), 'interruptible'),
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
      Scene.expect(Scene.role('dialog')).not.toExist()
    )
  })

  it('hides the scenario lab when the server does not expose dev controls', () => {
    Scene.scene(
      app,
      Scene.given(ready({ devScenarios })),
      Scene.click(Scene.role('button', { name: /Connection:/ })),
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
      Scene.given(
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
})
