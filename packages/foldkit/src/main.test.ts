import {
  DevScenario,
  DevScenariosStatus,
  MessageNodeResponse,
  ModelOption,
  ProjectResponse,
  SessionResponse,
} from '@sorato/api'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'
import {
  ActivateDevScenario,
  CompactRange,
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
  StartedRun,
} from './api.ts'
import { ReceivedServerEvent } from './events.ts'
import { Model, initialModel, update } from './main.ts'
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
  it('shows loading and resolves initial workspace loading', () => {
    Scene.scene(
      app,
      Scene.given(initialModel),
      Scene.expect(Scene.role('status')).toHaveText('loading'),
      Scene.Command.expectNone()
    )
    Scene.scene(
      app,
      Scene.given({ ...initialModel, status: 'ready' }),
      Scene.click(Scene.role('button', { name: 'Connect' })),
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
      Scene.expect(Scene.text('Sorato')).toExist()
    )
  })

  it('selects a project and session through command resolution', () => {
    Scene.scene(
      app,
      Scene.given(ready()),
      Scene.click(Scene.role('button', { name: 'Sorato' })),
      Scene.Command.expectHas(LoadModels),
      Scene.Command.resolve(
        LoadModels,
        LoadedModels({
          projectId: 'p1',
          models: [modelOption],
          defaultModel: 'provider/model',
        })
      ),
      Scene.click(Scene.role('button', { name: 'Foldkit rewrite' })),
      Scene.Command.expectHas(LoadTranscript),
      Scene.Command.resolve(
        LoadTranscript,
        LoadedTranscript({
          sessionId: 's1',
          snapshot: { sequence: 1, nodes: [] },
        })
      ),
      Scene.expect(Scene.text('No messages yet. Start a run below.')).toExist()
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
      Scene.click(Scene.role('button', { name: 'Send' })),
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
      Scene.click(Scene.role('button', { name: 'Connect' })),
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
      Scene.change(Scene.label('Mock scenario'), 'interruptible'),
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
          projectId: 'p1',
          models: [modelOption],
          defaultModel: 'provider/model',
        })
      ),
      Scene.expect(Scene.text('Long enough to stop from the UI.')).toExist(),
      Scene.click(Scene.role('button', { name: 'Run selected scenario' })),
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

  it('hides the scenario lab when the server does not expose dev controls', () => {
    Scene.scene(
      app,
      Scene.given(ready({ devScenarios })),
      Scene.click(Scene.role('button', { name: 'Connect' })),
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
      Scene.expect(
        Scene.role('button', { name: 'Summarizing…' })
      ).toBeDisabled()
    )
  })
})
