import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BunServices } from '@effect/platform-bun'
import { Context, Effect, Fiber, Layer, Scope } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import type { Sandbox } from '@sorato/core'
import type { ServerEvent, StopResponse, StorageUnavailable } from '@sorato/api'
import { makeSqlitePersistenceLive } from '../../src/db/sqlite.ts'
import { EventBus, type EventBusApi } from '../../src/event-bus.ts'
import { ProjectStorage, type Project } from '../../src/project/project.ts'
import { ProviderAuthStore } from '../../src/provider-auth.ts'
import { runAgent } from '../../src/run-agent.ts'
import { enqueueRunRequest, stopRun, stopSession } from '../../src/sessions.ts'
import {
  installRunLifecycleCheckpointController,
  type RunLifecycleCheckpoint,
  type RunLifecycleCheckpointName,
} from '../../src/run-lifecycle-checkpoints.ts'
import {
  clearActiveFiber,
  clearStartingRun,
  isRunActive,
  releaseRunQueue,
  registerActiveFiber,
  resetRunRegistry,
  startRunQueue,
  shiftQueuedRun,
  type RunRequest,
} from '../../src/run-registry.ts'
import {
  SessionStorage,
  type MessageNode,
  type Run,
  type Session,
  type SessionStorageApi,
  type StorageError,
} from '../../src/session/session.ts'
import { SqliteSession } from '../../src/session/sqlite-session.ts'
import { RuntimeConfigService } from '../../src/runtime-config.ts'
import {
  recordedEventBusLayer,
  EventRecorder,
  type EventRecorderApi,
} from './event-recorder.ts'
import { mockSandboxLayer, type MockSandboxOptions } from './mock-sandbox.ts'
import {
  ScriptedModelController,
  type ScriptedModelControllerApi,
  scriptedModelLayer,
  type ScriptedModelStep,
} from './scripted-model.ts'

export const TEST_PROJECT_ID = '/tmp/sorato-test-project'
export const TEST_MODEL = 'openai/gpt-5.4-mini'

export interface RunScenarioOptions {
  readonly files?: MockSandboxOptions['files']
  readonly model:
    | ReadonlyArray<ScriptedModelStep>
    | ReadonlyArray<ReadonlyArray<ScriptedModelStep>>
}

export interface StartRunOptions {
  readonly input: string
  readonly baseNodeId?: string | null | undefined
  readonly runId?: string | undefined
}

export interface StartedRun {
  readonly sessionId: string
  readonly runId: string
  readonly fiber?: Fiber.Fiber<void | undefined, never> | undefined
}

export interface RunScenarioCheckpointsApi {
  readonly waitFor: (
    name: RunLifecycleCheckpointName,
    runId: string
  ) => Effect.Effect<void>
  readonly release: (
    name: RunLifecycleCheckpointName,
    runId: string
  ) => Effect.Effect<void>
  readonly reached: Effect.Effect<ReadonlyArray<RunLifecycleCheckpoint>>
}

export interface RunScenarioApi {
  readonly session: Session
  readonly startRun: (
    options: StartRunOptions
  ) => Effect.Effect<StartedRun, never, Scope.Scope>
  readonly enqueueRun: (
    options: StartRunOptions
  ) => Effect.Effect<StartedRun, StorageError | StorageUnavailable>
  readonly stopSession: () => Effect.Effect<StopResponse, StorageError>
  readonly stopRun: (runId: string) => Effect.Effect<StopResponse, StorageError>
  readonly interruptFiber: (runId: string) => Effect.Effect<void>
  readonly waitForEvent: (
    predicate: (event: ServerEvent) => boolean
  ) => Effect.Effect<ServerEvent>
  readonly waitForRunStart: (runId: string) => Effect.Effect<ServerEvent>
  readonly waitForRunEnd: (runId: string) => Effect.Effect<ServerEvent>
  readonly waitForMessagesAppended: (
    runId: string
  ) => Effect.Effect<ServerEvent>
  readonly events: Effect.Effect<ReadonlyArray<ServerEvent>>
  readonly eventsForRun: (
    runId: string
  ) => Effect.Effect<ReadonlyArray<ServerEvent>>
  readonly messages: (
    headNodeId?: string | null
  ) => Effect.Effect<ReadonlyArray<MessageNode>, StorageError>
  readonly messagesForRun: (
    runId: string
  ) => Effect.Effect<ReadonlyArray<MessageNode>, StorageError>
  readonly latestNodeForRun: (
    runId: string
  ) => Effect.Effect<MessageNode | null, StorageError>
  readonly getRun: (runId: string) => Effect.Effect<Run, StorageError>
  readonly isRunActive: (runId: string) => Effect.Effect<boolean>
  readonly model: ScriptedModelControllerApi
  readonly checkpoints: RunScenarioCheckpointsApi
}

type RunScenarioServices =
  | EventBus
  | EventRecorder
  | ProjectStorage
  | ProviderAuthStore
  | RuntimeConfigService
  | Sandbox
  | ScriptedModelController
  | SessionStorage

const testProjectLayer = Layer.succeed(ProjectStorage, {
  createLocalDirectory: () => Effect.succeed(testProject()),
  get: () => Effect.succeed(testProject()),
  list: () => Effect.succeed([testProject()]),
  touch: () => Effect.void,
  archive: () => Effect.void,
  resolvePath: () => Effect.succeed(TEST_PROJECT_ID),
})

const testProject = (): Project => ({
  id: TEST_PROJECT_ID,
  name: 'sorato-test-project',
  path: TEST_PROJECT_ID,
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  archivedAt: null,
})

const providerAuthLayer = Layer.succeed(ProviderAuthStore, {
  getAuth: () => Effect.succeed(undefined),
  setApiKey: () => Effect.void,
  setOauth: () => Effect.void,
  providerApiKey: () => Effect.succeed('test-api-key'),
  hasProviderAuth: () => Effect.succeed(true),
})

const runtimeConfigLayer = Layer.succeed(RuntimeConfigService, {
  get: () =>
    Effect.succeed({
      default_model: TEST_MODEL,
      title_model: null,
    }),
})

const sqliteLayer = (path: string) =>
  Layer.merge(SqliteSession({ path }), insertProject).pipe(
    Layer.provide(makeSqlitePersistenceLive({ filename: path })),
    Layer.provide(BunServices.layer)
  )

const insertProject = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const now = Date.now()
    yield* sql`
      INSERT OR IGNORE INTO projects (
        id,
        name,
        path,
        created_at,
        updated_at,
        last_opened_at
      )
      VALUES (${TEST_PROJECT_ID}, 'sorato-test-project', ${TEST_PROJECT_ID}, ${now}, ${now}, ${now})
    `
  })
)

const requestFor = (options: StartRunOptions, runId: string): RunRequest => ({
  runId,
  inputs: [{ text: options.input, attachments: [] }],
  model: TEST_MODEL,
  modelOptions: { thinkingLevel: 'off' },
  baseNodeId: options.baseNodeId ?? null,
  afterRunId: null,
})

const stableRunId = (runId?: string) => runId ?? crypto.randomUUID()

const queueStartArgs = (options: StartRunOptions) =>
  [
    options.input,
    [] as const,
    TEST_MODEL,
    { thinkingLevel: 'off' as const },
    options.baseNodeId ?? null,
    null,
  ] as const
const cleanupDirectRun = (runId: string) =>
  Effect.sync(() => {
    clearActiveFiber(runId)
    releaseRunQueue(runId)
  })

const makeStartRun =
  (
    session: Session,
    layerContext: Context.Context<RunScenarioServices>,
    scope: Scope.Scope,
    fibers: Map<string, Fiber.Fiber<void, never>>
  ) =>
  (startOptions: StartRunOptions) =>
    Effect.gen(function* () {
      const runId = stableRunId(startOptions.runId)
      const request = requestFor(startOptions, runId)
      startRunQueue(session.id, request)
      shiftQueuedRun(runId)
      clearStartingRun(runId, runId)
      const cleanupRun = cleanupDirectRun(runId)
      const fiber = yield* runAgent(session.id, request).pipe(
        Effect.ensuring(cleanupRun),
        Effect.provideContext(layerContext),
        Effect.forkIn(scope)
      )
      registerActiveFiber(
        runId,
        runId,
        startOptions.baseNodeId ?? null,
        'agent',
        'primary',
        fiber
      )
      fibers.set(runId, fiber)
      return { sessionId: session.id, runId, fiber }
    })

const makeEnqueueRun =
  (
    session: Session,
    storage: SessionStorageApi,
    layerContext: Context.Context<RunScenarioServices>
  ) =>
  (startOptions: StartRunOptions) =>
    Effect.gen(function* () {
      const runId = stableRunId(startOptions.runId)
      const args = queueStartArgs({ ...startOptions, runId })
      const response = yield* enqueueRunRequest(
        storage,
        session.id,
        ...args
      ).pipe(Effect.provideContext(layerContext))
      return {
        sessionId: session.id,
        runId: response.runId,
        fiber: undefined,
      }
    })

const makeInterruptFiber =
  (
    session: Session,
    bus: EventBusApi,
    fibers: Map<string, Fiber.Fiber<void, never>>
  ) =>
  (runId: string) =>
    Effect.gen(function* () {
      const fiber = fibers.get(runId)
      if (!fiber) return

      yield* Fiber.interrupt(fiber).pipe(Effect.exit)
      clearActiveFiber(runId)
      releaseRunQueue(runId)
      yield* bus.publish({ _tag: 'RunEnd', sessionId: session.id, runId })
    })

const waitForRunEvent =
  (recorder: EventRecorderApi, tag: ServerEvent['_tag']) => (runId: string) =>
    recorder.waitFor(
      (event) => 'runId' in event && event._tag === tag && event.runId === runId
    )

const messagesForRun =
  (storage: SessionStorageApi, sessionId: string) => (runId: string) =>
    storage
      .messages(sessionId)
      .pipe(
        Effect.map((messages) =>
          messages.filter((message) => message.runId === runId)
        )
      )

const latestMessageForRun =
  (storage: SessionStorageApi, sessionId: string) => (runId: string) =>
    messagesForRun(
      storage,
      sessionId
    )(runId).pipe(Effect.map((messages) => messages.at(-1) ?? null))

const buildScenarioApi = (
  layerContext: Context.Context<RunScenarioServices>,
  scope: Scope.Scope
) =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage
    const recorder = yield* EventRecorder
    const bus = yield* EventBus
    const model = yield* ScriptedModelController
    const session = yield* storage.create(TEST_PROJECT_ID, 'scenario')
    const fibers = new Map<string, Fiber.Fiber<void, never>>()
    const checkpointController = yield* installRunLifecycleCheckpointController
    yield* Scope.addFinalizer(scope, checkpointController.reset)

    return {
      session,
      startRun: makeStartRun(session, layerContext, scope, fibers),
      enqueueRun: makeEnqueueRun(session, storage, layerContext),
      stopSession: () =>
        stopSession(storage, session.id).pipe(
          Effect.provideContext(layerContext)
        ),
      stopRun: (runId: string) =>
        stopRun(storage, runId).pipe(Effect.provideContext(layerContext)),
      interruptFiber: makeInterruptFiber(session, bus, fibers),
      waitForEvent: recorder.waitFor,
      waitForRunStart: waitForRunEvent(recorder, 'RunStart'),
      waitForRunEnd: waitForRunEvent(recorder, 'RunEnd'),
      waitForMessagesAppended: waitForRunEvent(recorder, 'MessagesAppended'),
      events: recorder.events,
      eventsForRun: recorder.eventsForRun,
      messages: (headNodeId?: string | null) =>
        storage.messages(session.id, headNodeId),
      messagesForRun: messagesForRun(storage, session.id),
      latestNodeForRun: latestMessageForRun(storage, session.id),
      getRun: (runId: string) => storage.getRun(runId),
      isRunActive: (runId: string) => Effect.sync(() => isRunActive(runId)),
      model,
      checkpoints: checkpointController,
    } satisfies RunScenarioApi
  }).pipe(Effect.provideContext(layerContext))

export const makeRunScenario = (options: RunScenarioOptions) => {
  const dbPath = join(tmpdir(), `sorato-run-scenario-${crypto.randomUUID()}.db`)
  const layer = Layer.mergeAll(
    sqliteLayer(dbPath),
    testProjectLayer,
    providerAuthLayer,
    runtimeConfigLayer,
    recordedEventBusLayer,
    mockSandboxLayer({ files: options.files }),
    scriptedModelLayer(options.model)
  )

  return Effect.gen(function* () {
    yield* Effect.sync(resetRunRegistry)
    const scope = yield* Effect.scope
    const layerContext = yield* Layer.buildWithScope(layer, scope)

    return yield* buildScenarioApi(layerContext, scope)
  })
}
