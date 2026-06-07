/**
 * Sessions group handler implementation.
 *
 * Delegates to server-owned SessionStorage. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Cause, Effect, Fiber, Match } from 'effect'
import { ProjectStorage } from './project/project.ts'
import {
  SessionStorage,
  type MessageNode,
  type ModelCall,
  type SessionStorageApi,
} from './session/session.ts'
import {
  Api,
  MessageNodeResponse,
  RunSummaryResponse,
  RunUsageResponse,
  ProjectOperationFailed,
  RunResponse,
  SessionResponse,
  StopResponse,
  StorageUnavailable,
} from './api.ts'
import { ensureModel } from './model-catalog.ts'
import type { ModelOptions } from './model-catalog.ts'
import type { RunRequest } from './run-registry.ts'
import { runAgent } from './run-agent.ts'
import {
  clearActiveFiber,
  drainQueuedRuns as drainQueuedInputs,
  enqueueRun,
  getFiber,
  getQueuedRunCount,
  isRunning,
  requestStop,
  registerActiveFiber,
  registerWorkerFiber,
  releaseRun,
  shouldStop,
  shiftQueuedRun,
} from './run-registry.ts'
import { publish } from './event-bus.ts'

const toSessionResponse = (s: {
  readonly id: string
  readonly projectId: string
  readonly title: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly archivedAt: number | null
  readonly lastUserMessageAt: number | null
}) => {
  const status = Match.value(isRunning(s.id)).pipe(
    Match.when(true, () => 'running' as const),
    Match.orElse(() => 'idle' as const)
  )

  return new SessionResponse({
    id: s.id,
    projectId: s.projectId,
    title: s.title,
    status,
    archivedAt: s.archivedAt,
    lastUserMessageAt: s.lastUserMessageAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  })
}

const toMessageNodeResponse = (m: {
  readonly id: string
  readonly sessionId: string
  readonly parentId: string | null
  readonly kind: 'message' | 'summary'
  readonly messageId: string | null
  readonly summaryId: string | null
  readonly sourceNodeId: string | null
  readonly runId: string | null
  readonly run: {
    readonly id: string
    readonly status: 'running' | 'completed' | 'interrupted' | 'failed'
    readonly providerId: string
    readonly modelId: string
    readonly billingMode: 'api-key' | 'subscription'
    readonly inputTokens: number | null
    readonly outputTokens: number | null
    readonly reasoningTokens: number | null
    readonly cacheReadTokens: number | null
    readonly cacheWriteTokens: number | null
    readonly totalTokens: number | null
    readonly contextWindowTokens: number | null
    readonly actualCostMicrosUsd: number | null
    readonly listPriceMicrosUsd: number | null
    readonly createdAt: number
    readonly completedAt: number | null
  } | null
  readonly modelCall: ModelCall | null
  readonly encoded: unknown
  readonly createdAt: number
}) =>
  new MessageNodeResponse({
    id: m.id,
    sessionId: m.sessionId,
    parentId: m.parentId,
    kind: m.kind,
    messageId: m.messageId,
    summaryId: m.summaryId,
    sourceNodeId: m.sourceNodeId,
    runId: m.runId,
    run:
      m.run === null
        ? null
        : new RunSummaryResponse({
            id: m.run.id,
            status: m.run.status,
            providerId: m.run.providerId,
            modelId: m.run.modelId,
            billingMode: m.run.billingMode,
            usage: new RunUsageResponse({
              inputTokens: m.run.inputTokens,
              outputTokens: m.run.outputTokens,
              reasoningTokens: m.run.reasoningTokens,
              cacheReadTokens: m.run.cacheReadTokens,
              cacheWriteTokens: m.run.cacheWriteTokens,
              totalTokens: m.run.totalTokens,
              contextWindowTokens: m.run.contextWindowTokens,
              actualCostMicrosUsd: m.run.actualCostMicrosUsd,
              listPriceMicrosUsd: m.run.listPriceMicrosUsd,
            }),
            createdAt: m.run.createdAt,
            completedAt: m.run.completedAt,
          }),
    modelCall: m.modelCall,
    encoded: m.encoded,
    createdAt: m.createdAt,
  })

const modelOptions = (options?: {
  readonly thinkingLevel?:
    | 'off'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | undefined
  readonly mode?: string | undefined
}): ModelOptions => ({
  ...Match.value(options?.thinkingLevel).pipe(
    Match.when(undefined, () => ({})),
    Match.orElse((thinkingLevel) => ({ thinkingLevel }))
  ),
  ...Match.value(options?.mode).pipe(
    Match.when(undefined, () => ({})),
    Match.orElse((mode) => ({ mode }))
  ),
})

const registerActiveRun = Effect.fn('Sessions.registerActiveRun')(
  (sessionId: string, fiber: Fiber.Fiber<void, never>) =>
    Effect.suspend(() => doRegisterActiveRun(sessionId, fiber))
)

const clearActiveRun = Effect.fn('Sessions.clearActiveRun')(
  (sessionId: string) => Effect.suspend(() => doClearActiveRun(sessionId))
)

const releaseQueuedRun = Effect.fn('Sessions.releaseQueuedRun')(
  (sessionId: string) => Effect.suspend(() => doReleaseQueuedRun(sessionId))
)

const registerRunWorker = Effect.fn('Sessions.registerRunWorker')(
  (sessionId: string, fiber: Fiber.Fiber<void, never>) =>
    Effect.suspend(() => doRegisterRunWorker(sessionId, fiber))
)

const requestRunStop = Effect.fn('Sessions.requestRunStop')(
  (sessionId: string) => Effect.suspend(() => doRequestRunStop(sessionId))
)

const drainQueuedInputsNow = Effect.fn('Sessions.drainQueuedInputs')(
  (sessionId: string) =>
    Effect.suspend(() => Effect.succeed(drainQueuedInputs(sessionId)))
)

const publishMessagesAppended = Effect.fn('Sessions.publishMessagesAppended')(
  (sessionId: string) =>
    Effect.suspend(() => doPublishMessagesAppended(sessionId))
)

const doRegisterActiveRun = (
  sessionId: string,
  fiber: Fiber.Fiber<void, never>
) => {
  registerActiveFiber(sessionId, fiber)
  return Effect.void
}

const doClearActiveRun = (sessionId: string) => {
  clearActiveFiber(sessionId)
  return Effect.void
}

const doReleaseQueuedRun = (sessionId: string) => {
  releaseRun(sessionId)
  return Effect.void
}

const doRegisterRunWorker = (
  sessionId: string,
  fiber: Fiber.Fiber<void, never>
) => {
  registerWorkerFiber(sessionId, fiber)
  return Effect.void
}

const doRequestRunStop = (sessionId: string) => {
  requestStop(sessionId)
  return Effect.void
}

const doPublishMessagesAppended = (sessionId: string) => {
  publish({ _tag: 'MessagesAppended', sessionId })
  return Effect.void
}

function isDescendantOrSame(
  messages: ReadonlyArray<MessageNode>,
  nodeId: string,
  ancestorId: string | null
) {
  if (ancestorId === null) return true

  const byId = new Map(messages.map((message) => [message.id, message]))
  const seen = new Set<string>()
  let cursor: string | null = nodeId

  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }

  return false
}

function finalPersistedRunNode(
  messages: ReadonlyArray<MessageNode>,
  runId: string,
  baseNodeId: string | null
): MessageNode | undefined {
  const runMessages = messages.filter((message) => message.runId === runId)
  const hasGeneratedOutput = runMessages.some(
    (message) =>
      message.encoded.role === 'assistant' ||
      message.encoded.role === 'tool' ||
      message.encoded.role === 'system'
  )
  if (!hasGeneratedOutput) return undefined

  const runIds = new Set(runMessages.map((message) => message.id))
  const parentIds = new Set(
    runMessages
      .map((message) => message.parentId)
      .filter((id): id is string => id !== null && runIds.has(id))
  )

  return (
    runMessages
      .toReversed()
      .find(
        (message) =>
          !parentIds.has(message.id) &&
          isDescendantOrSame(messages, message.id, baseNodeId)
      ) ?? undefined
  )
}

const resolveRunBase = (
  storage: SessionStorageApi,
  sessionId: string,
  request: RunRequest
) => {
  const afterRunId = request.afterRunId
  if (afterRunId === null) return Effect.succeed(request)

  return storage.messages(sessionId).pipe(
    Effect.map((messages) =>
      finalPersistedRunNode(messages, afterRunId, request.baseNodeId)
    ),
    Effect.map((node) => ({
      ...request,
      afterRunId: null,
      baseNodeId: node?.id ?? request.baseNodeId,
    }))
  )
}

function createRunWorker(sessionId: string) {
  const clearActive = clearActiveRun(sessionId)
  const releaseRunNow = releaseQueuedRun(sessionId)
  const releaseSession = Effect.gen(function* () {
    yield* Effect.logInfo('Session run worker releasing session')
    yield* releaseRunNow
  })

  return Effect.gen(function* () {
    const storage = yield* SessionStorage
    yield* Effect.logInfo('Session run worker starting')

    while (true) {
      const stopRequested = shouldStop(sessionId)
      if (stopRequested) {
        yield* Effect.logInfo('Session run worker stopping before next run')
        break
      }

      const input = shiftQueuedRun(sessionId)
      if (!input) {
        yield* Effect.logInfo('Session run worker queue drained')
        break
      }

      yield* Effect.logInfo('Session run worker starting queued run', {
        model: input.model,
        modelOptions: input.modelOptions,
        inputCount: input.inputs.length,
        inputLength: input.inputs.join('\n').length,
        queuedRunCount: getQueuedRunCount(sessionId),
      })

      const request = yield* resolveRunBase(storage, sessionId, input).pipe(
        Effect.orDie
      )
      const fiber = yield* Effect.forkDetach(runAgent(sessionId, request))
      yield* registerActiveRun(sessionId, fiber)
      yield* Effect.logInfo('Session run worker registered active run')

      const joinedFiber = Fiber.join(fiber)
      yield* joinedFiber.pipe(
        Effect.tap(() =>
          Effect.logInfo('Session run worker joined active run')
        ),
        Effect.tapCause((cause) =>
          Effect.logError('Session run worker observed active run failure', {
            cause: Cause.pretty(cause),
          })
        ),
        Effect.ensuring(clearActive)
      )
    }
  }).pipe(
    Effect.ensuring(releaseSession),
    Effect.annotateLogs('sessionId', sessionId)
  )
}

function startRunWorker(sessionId: string, runId: string) {
  const onWorkerError = releaseQueuedRun(sessionId)

  return Effect.forkDetach(createRunWorker(sessionId)).pipe(
    Effect.tap(() =>
      Effect.logInfo('Session run worker forked', { sessionId })
    ),
    Effect.tap((fiber) => registerRunWorker(sessionId, fiber)),
    Effect.map(() => new RunResponse({ status: 'started' as const, runId })),
    Effect.onError((cause) =>
      Effect.gen(function* () {
        yield* Effect.logError('Session run worker failed to start', {
          sessionId,
          cause: Cause.pretty(cause),
        })
        yield* onWorkerError
      })
    )
  )
}

const selectRunResponse = (
  sessionId: string,
  status: 'queued' | 'started',
  runId: string
) =>
  ({
    queued: Effect.succeed(
      new RunResponse({ status: 'queued' as const, runId })
    ),
    started: startRunWorker(sessionId, runId),
  })[status]

const appendStoppedQueuedInputs = (
  storage: SessionStorageApi,
  sessionId: string,
  queuedInputs: ReadonlyArray<RunRequest>
) =>
  Effect.forEach(queuedInputs, (queuedRequest) =>
    Effect.gen(function* () {
      const request = yield* resolveRunBase(storage, sessionId, queuedRequest)
      const runId = request.runId
      const [providerId = 'unknown', ...rest] = request.model.split('/')
      yield* storage.createRun({
        id: runId,
        sessionId,
        providerId,
        modelId: rest.join('/') || request.model,
        billingMode: 'api-key',
        baseNodeId: request.baseNodeId,
      })
      yield* storage.completeRun({ id: runId, status: 'interrupted' })
      yield* storage.append(
        sessionId,
        runId,
        request.inputs.map((input) => ({
          role: 'user' as const,
          content: input,
        })),
        request.baseNodeId
      )
    })
  )

function stopWithoutActiveFiber(storage: SessionStorageApi, sessionId: string) {
  const isSessionRunning = Number(isRunning(sessionId))
  const notRunningResponse = Effect.succeed(
    new StopResponse({ status: 'not_running' })
  )
  const runningResponse = Effect.gen(function* () {
    const queuedInputs = yield* drainQueuedInputsNow(sessionId)
    const appendedQueuedInputs = appendStoppedQueuedInputs(
      storage,
      sessionId,
      queuedInputs
    ).pipe(Effect.tap(() => publishMessagesAppended(sessionId)))
    const appendQueuedInputs =
      [Effect.void, appendedQueuedInputs][Number(queuedInputs.length > 0)] ??
      Effect.void

    yield* appendQueuedInputs
    return new StopResponse({ status: 'stopped' })
  })

  return (
    [notRunningResponse, runningResponse][isSessionRunning] ??
    notRunningResponse
  )
}

const stopWithActiveFiber = Effect.fn('Sessions.stopWithActiveFiber')(
  function* (
    storage: SessionStorageApi,
    sessionId: string,
    fiber: Fiber.Fiber<void, never>
  ) {
    // Interrupt the running fiber and wait for it to finish.
    // The fiber's uninterruptible cleanup persists partial
    // assistant content before terminating, so the system message
    // we append below is guaranteed to come AFTER the partial turn.
    yield* Fiber.interrupt(fiber)

    const queuedInputs = yield* drainQueuedInputsNow(sessionId)

    yield* appendStoppedQueuedInputs(storage, sessionId, queuedInputs)
    if (queuedInputs.length > 0) yield* publishMessagesAppended(sessionId)

    return new StopResponse({ status: 'stopped' })
  }
)

const stopSession = Effect.fn('Sessions.stopSession')(function* (
  storage: SessionStorageApi,
  sessionId: string
) {
  yield* Effect.logInfo('Session stop request received', { sessionId })
  yield* requestRunStop(sessionId)
  const fiber = getFiber(sessionId)
  const stopEffect = Match.value(fiber).pipe(
    Match.when(undefined, () => stopWithoutActiveFiber(storage, sessionId)),
    Match.orElse((fiber) => stopWithActiveFiber(storage, sessionId, fiber))
  )

  return yield* stopEffect
})

const mapStorageError = StorageUnavailable.fromStorage
const mapProjectError = ProjectOperationFailed.fromProject

export const SessionsLive = HttpApiBuilder.group(Api, 'sessions', (handlers) =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage
    const projects = yield* ProjectStorage

    return handlers
      .handle('list', () =>
        storage.list().pipe(
          Effect.map((sessions) => sessions.map(toSessionResponse)),
          Effect.mapError(mapStorageError)
        )
      )
      .handle('create', ({ payload }) =>
        projects
          .get(payload.projectId)
          .pipe(
            Effect.mapError(mapProjectError),
            Effect.andThen(
              projects
                .touch(payload.projectId)
                .pipe(Effect.mapError(mapProjectError))
            ),
            Effect.andThen(
              storage
                .create(payload.projectId, payload.title)
                .pipe(Effect.mapError(mapStorageError))
            ),
            Effect.map(toSessionResponse)
          )
      )
      .handle('get', ({ params }) =>
        storage
          .get(params.id)
          .pipe(Effect.map(toSessionResponse), Effect.mapError(mapStorageError))
      )
      .handle('delete', ({ params }) =>
        storage.delete(params.id).pipe(Effect.mapError(mapStorageError))
      )
      .handle('leaves', ({ params }) =>
        storage.leaves(params.id).pipe(
          Effect.map((nodes) => nodes.map(toMessageNodeResponse)),
          Effect.mapError(mapStorageError)
        )
      )
      .handle('messages', ({ params }) =>
        storage.messages(params.id).pipe(
          Effect.map((nodes) => nodes.map(toMessageNodeResponse)),
          Effect.mapError(mapStorageError)
        )
      )
      .handle('run', ({ params, payload }) =>
        storage.get(params.id).pipe(
          Effect.mapError(mapStorageError),
          Effect.tap(() =>
            Effect.logInfo('Session run request received', {
              sessionId: params.id,
              model: payload.model,
              modelOptions: modelOptions(payload.modelOptions),
              baseNodeId: payload.baseNodeId,
              inputLength: payload.input.length,
            })
          ),
          Effect.flatMap((session) =>
            projects.resolvePath(session.projectId).pipe(
              Effect.mapError(mapProjectError),
              Effect.tap(() =>
                projects
                  .touch(session.projectId)
                  .pipe(Effect.mapError(mapProjectError))
              ),
              Effect.flatMap((projectPath) =>
                ensureModel(
                  projectPath,
                  payload.model,
                  modelOptions(payload.modelOptions)
                )
              )
            )
          ),
          Effect.tap(() =>
            Effect.logInfo('Session run request model available', {
              sessionId: params.id,
              model: payload.model,
            })
          ),
          Effect.flatMap(() =>
            Effect.suspend(() => {
              const runId = crypto.randomUUID()
              const run = enqueueRun(params.id, {
                runId,
                inputs: [payload.input],
                model: payload.model,
                modelOptions: modelOptions(payload.modelOptions),
                baseNodeId: payload.baseNodeId,
                afterRunId: payload.afterRunId ?? null,
              })
              return Effect.logInfo('Session run request enqueued', {
                sessionId: params.id,
                status: run.status,
                runId: run.runId,
                queuedRunCount: getQueuedRunCount(params.id),
              }).pipe(
                Effect.andThen(
                  selectRunResponse(params.id, run.status, run.runId)
                )
              )
            })
          )
        )
      )
      .handle('stop', ({ params }) =>
        stopSession(storage, params.id).pipe(Effect.mapError(mapStorageError))
      )
  })
)
