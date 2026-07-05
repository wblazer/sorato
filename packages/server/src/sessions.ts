/**
 * Sessions group handler implementation.
 *
 * Delegates to server-owned SessionStorage. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Prompt } from 'effect/unstable/ai'
import { Cause, Effect, Fiber, Match } from 'effect'
import { ProjectStorage } from './project/project.ts'
import {
  SessionStorage,
  type MessageNode,
  type SessionStorageApi,
} from './session/session.ts'
import {
  Api,
  CompactRunResponse,
  MessageNodeResponse,
  RunSummaryResponse,
  RunUsageResponse,
  ProjectOperationFailed,
  RunResponse,
  SessionResponse,
  StopResponse,
  StorageUnavailable,
} from '@sorato/api'
import { ensureModel } from './model-catalog.ts'
import type { ModelOptions, ThinkingLevel } from './model-catalog.ts'
import type { RunAttachment, RunRequest } from './run-registry.ts'
import { runAgent } from './run-agent.ts'
import {
  clearActiveFiber,
  drainQueuedRuns as drainQueuedInputs,
  enqueueRun,
  getActiveRuns,
  getFibers,
  getQueuedRunCount,
  isRunning,
  isRunActive,
  requestStop,
  registerActiveFiber,
  registerWorkerFiber,
  releaseRunQueue,
  shouldStop,
  shiftQueuedRun,
} from './run-registry.ts'
import { EventBus } from './event-bus.ts'
import { getActiveBackgroundReplayRuns } from './event-replay.ts'

const toSessionResponse = (s: {
  readonly id: string
  readonly projectId: string
  readonly title: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly archivedAt: number | null
  readonly lastUserMessageAt: number | null
}) => {
  const activeRunsById = new Map(
    [...getActiveRuns(s.id), ...getActiveBackgroundReplayRuns(s.id)].map(
      (run) => [run.runId, run]
    )
  )
  const activeRuns = [...activeRunsById.values()]
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
    activeRuns,
  })
}

const toMessageNodeResponse = (m: MessageNode) =>
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
  readonly thinkingLevel?: ThinkingLevel | undefined
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
  (
    queueId: string,
    runId: string,
    baseNodeId: string | null,
    kind: 'agent' | 'summary',
    visibility: 'primary' | 'background',
    fiber: Fiber.Fiber<void, never>
  ) =>
    Effect.suspend(() =>
      doRegisterActiveRun(queueId, runId, baseNodeId, kind, visibility, fiber)
    )
)

const clearActiveRun = Effect.fn('Sessions.clearActiveRun')((queueId: string) =>
  Effect.suspend(() => doClearActiveRun(queueId))
)

const releaseQueuedRun = Effect.fn('Sessions.releaseQueuedRun')(
  (queueId: string) => Effect.suspend(() => doReleaseQueuedRun(queueId))
)

const registerRunWorker = Effect.fn('Sessions.registerRunWorker')(
  (queueId: string, fiber: Fiber.Fiber<void, never>) =>
    Effect.suspend(() => doRegisterRunWorker(queueId, fiber))
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

const publishRunEnd = Effect.fn('Sessions.publishRunEnd')(
  (sessionId: string, runId: string) =>
    Effect.suspend(() => doPublishRunEnd(sessionId, runId))
)

const doRegisterActiveRun = (
  queueId: string,
  runId: string,
  baseNodeId: string | null,
  kind: 'agent' | 'summary',
  visibility: 'primary' | 'background',
  fiber: Fiber.Fiber<void, never>
) => {
  registerActiveFiber(queueId, runId, baseNodeId, kind, visibility, fiber)
  return Effect.void
}

const doClearActiveRun = (queueId: string) => {
  clearActiveFiber(queueId)
  return Effect.void
}

const doReleaseQueuedRun = (queueId: string) => {
  releaseRunQueue(queueId)
  return Effect.void
}

const doRegisterRunWorker = (
  queueId: string,
  fiber: Fiber.Fiber<void, never>
) => {
  registerWorkerFiber(queueId, fiber)
  return Effect.void
}

const doRequestRunStop = (sessionId: string) => {
  requestStop(sessionId)
  return Effect.void
}

const doPublishMessagesAppended = (sessionId: string) => {
  return Effect.flatMap(EventBus, (bus) =>
    bus.publish({ _tag: 'MessagesAppended', sessionId })
  )
}

const doPublishRunEnd = (sessionId: string, runId: string) => {
  return Effect.flatMap(EventBus, (bus) =>
    bus.publish({ _tag: 'RunEnd', sessionId, runId })
  )
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

function deepestDescendantLeaf(
  messages: ReadonlyArray<MessageNode>,
  nodeId: string
): MessageNode | undefined {
  const childrenByParent = new Map<string | null, MessageNode[]>()
  for (const message of messages) {
    const children = childrenByParent.get(message.parentId) ?? []
    children.push(message)
    childrenByParent.set(message.parentId, children)
  }

  let best = messages.find((message) => message.id === nodeId)
  const visit = (message: MessageNode) => {
    best = message
    for (const child of childrenByParent.get(message.id) ?? []) visit(child)
  }
  if (best) visit(best)
  return best
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

  const runLeaf = runMessages
    .toReversed()
    .find(
      (message) =>
        !parentIds.has(message.id) &&
        isDescendantOrSame(messages, message.id, baseNodeId)
    )
  if (runLeaf) return runLeaf

  const compactedRoot = runMessages
    .toReversed()
    .find(
      (message) =>
        message.kind === 'summary' ||
        messages.some((candidate) => candidate.parentId === message.id)
    )
  return compactedRoot
    ? deepestDescendantLeaf(messages, compactedRoot.id)
    : undefined
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

const resolveRunTarget = Effect.fn('Sessions.resolveRunTarget')(function* (
  storage: SessionStorageApi,
  sessionId: string,
  request: RunRequest
) {
  const afterRunId = request.afterRunId
  if (afterRunId === null) return { request }
  if (isRunActive(afterRunId)) return { request, targetRunId: afterRunId }

  const messages = yield* storage.messages(sessionId)
  const node = finalPersistedRunNode(messages, afterRunId, request.baseNodeId)
  const baseNodeId = node?.id ?? request.baseNodeId
  const activeChild = getActiveRuns(sessionId).find(
    (run) => run.baseNodeId === baseNodeId
  )
  const resolvedRequest = {
    ...request,
    afterRunId: null,
    baseNodeId,
  }

  return activeChild
    ? { request: resolvedRequest, targetRunId: activeChild.runId }
    : { request: resolvedRequest }
})

function createRunWorker(sessionId: string, queueId: string) {
  const clearActive = clearActiveRun(queueId)
  const releaseRunNow = releaseQueuedRun(queueId)
  const releaseSession = Effect.gen(function* () {
    yield* Effect.logInfo('Session run worker releasing queue')
    yield* releaseRunNow
  })

  return Effect.gen(function* () {
    const storage = yield* SessionStorage
    yield* Effect.logInfo('Session run worker starting')

    while (true) {
      const stopRequested = shouldStop(queueId)
      if (stopRequested) {
        yield* Effect.logInfo('Session run worker stopping before next run')
        break
      }

      const input = shiftQueuedRun(queueId)
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
      const kind = request.compactRange === undefined ? 'agent' : 'summary'
      const visibility =
        request.compactRange === undefined ? 'primary' : 'background'
      const fiber = yield* Effect.forkDetach(runAgent(sessionId, request))
      yield* registerActiveRun(
        queueId,
        request.runId,
        request.baseNodeId,
        kind,
        visibility,
        fiber
      )
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

      if (shouldStop(queueId)) {
        yield* Effect.logInfo('Session run worker stopped after active run')
        break
      }

      yield* publishRunEnd(sessionId, request.runId)
    }
  }).pipe(
    Effect.ensuring(releaseSession),
    Effect.annotateLogs({ sessionId, queueId })
  )
}

function startRunWorker(
  sessionId: string,
  runId: string,
  queueId: string,
  baseNodeId: string | null
) {
  const onWorkerError = releaseQueuedRun(queueId)

  return Effect.forkDetach(createRunWorker(sessionId, queueId)).pipe(
    Effect.tap(() =>
      Effect.logInfo('Session run worker forked', { sessionId, queueId })
    ),
    Effect.tap((fiber) => registerRunWorker(queueId, fiber)),
    Effect.map(
      () =>
        new RunResponse({
          status: 'started' as const,
          runId,
          baseNodeId,
        })
    ),
    Effect.onError((cause) =>
      Effect.gen(function* () {
        yield* Effect.logError('Session run worker failed to start', {
          sessionId,
          queueId,
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
  runId: string,
  queueId: string,
  baseNodeId: string | null
) =>
  ({
    queued: Effect.succeed(
      new RunResponse({ status: 'queued' as const, runId, baseNodeId })
    ),
    started: startRunWorker(sessionId, runId, queueId, baseNodeId),
  })[status]

const appendStoppedQueuedInputs = (
  storage: SessionStorageApi,
  sessionId: string,
  queuedInputs: ReadonlyArray<RunRequest>
) =>
  Effect.forEach(queuedInputs, (queuedRequest) =>
    Effect.gen(function* () {
      if (queuedRequest.inputs.length === 0) return

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
      yield* storage.append(
        sessionId,
        runId,
        request.inputs.map((input) => ({
          role: 'user' as const,
          content:
            input.attachments.length === 0
              ? input.text
              : [
                  ...(input.text.trim().length > 0
                    ? [Prompt.makePart('text', { text: input.text })]
                    : []),
                  ...input.attachments.map((attachment) =>
                    Prompt.makePart('file', {
                      mediaType: attachment.mediaType,
                      fileName: attachment.fileName,
                      data: attachment.data,
                    })
                  ),
                ],
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

const stopWithActiveFibers = Effect.fn('Sessions.stopWithActiveFibers')(
  function* (
    storage: SessionStorageApi,
    sessionId: string,
    fibers: ReadonlyArray<Fiber.Fiber<void, never>>,
    runIds: ReadonlyArray<string>
  ) {
    const queuedInputs = yield* drainQueuedInputsNow(sessionId)

    // Interrupt running fibers and wait for them to finish. Each fiber's
    // uninterruptible cleanup persists partial assistant content before
    // terminating.
    yield* Effect.forEach(
      fibers,
      (fiber) => Fiber.interrupt(fiber).pipe(Effect.exit),
      {
        concurrency: 'unbounded',
        discard: true,
      }
    )

    yield* appendStoppedQueuedInputs(storage, sessionId, queuedInputs)
    if (queuedInputs.length > 0) yield* publishMessagesAppended(sessionId)
    yield* Effect.forEach(runIds, (runId) => publishRunEnd(sessionId, runId), {
      discard: true,
    })

    return new StopResponse({ status: 'stopped' })
  }
)

export const stopSession = Effect.fn('Sessions.stopSession')(function* (
  storage: SessionStorageApi,
  sessionId: string
) {
  yield* Effect.logInfo('Session stop request received', { sessionId })
  yield* requestRunStop(sessionId)
  const fibers = getFibers(sessionId)
  const activeRunIds = getActiveRuns(sessionId).map((run) => run.runId)
  const stopEffect = Match.value(fibers.length).pipe(
    Match.when(0, () => stopWithoutActiveFiber(storage, sessionId)),
    Match.orElse(() =>
      stopWithActiveFibers(storage, sessionId, fibers, activeRunIds)
    )
  )

  return yield* stopEffect
})

const enqueueRunRequest = Effect.fn('Sessions.enqueueRunRequest')((
  storage: SessionStorageApi,
  sessionId: string,
  input: string,
  attachments: ReadonlyArray<RunAttachment>,
  model: string,
  options: ModelOptions,
  baseNodeId: string | null,
  afterRunId: string | null,
  compactRange?: RunRequest['compactRange']
) => {
  const runId = crypto.randomUUID()
  const initialRequest = {
    runId,
    inputs: compactRange === undefined ? [{ text: input, attachments }] : [],
    model,
    modelOptions: options,
    baseNodeId,
    afterRunId,
    compactRange,
  }
  return resolveRunTarget(storage, sessionId, initialRequest).pipe(
    Effect.mapError(StorageUnavailable.fromStorage),
    Effect.flatMap((target) =>
      Effect.suspend(() => {
        const run = enqueueRun(sessionId, target.request, target.targetRunId)
        return Effect.logInfo('Session run request enqueued', {
          sessionId,
          status: run.status,
          runId: run.runId,
          targetRunId: target.targetRunId,
          queuedRunCount: getQueuedRunCount(sessionId),
        }).pipe(
          Effect.andThen(
            selectRunResponse(
              sessionId,
              run.status,
              run.runId,
              run.queueId,
              target.request.baseNodeId
            )
          )
        )
      })
    )
  )
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
            enqueueRunRequest(
              storage,
              params.id,
              payload.input,
              payload.attachments ?? [],
              payload.model,
              modelOptions(payload.modelOptions),
              payload.baseNodeId,
              payload.afterRunId ?? null
            )
          )
        )
      )
      .handle('compactRange', ({ params, payload }) =>
        storage.get(params.id).pipe(
          Effect.mapError(mapStorageError),
          Effect.flatMap((session) =>
            projects.resolvePath(session.projectId).pipe(
              Effect.mapError(mapProjectError),
              Effect.tap(() =>
                projects
                  .touch(session.projectId)
                  .pipe(Effect.mapError(mapProjectError))
              ),
              Effect.flatMap((projectPath) =>
                ensureModel(projectPath, payload.model, {
                  thinkingLevel: 'off',
                })
              )
            )
          ),
          Effect.flatMap(() =>
            enqueueRunRequest(
              storage,
              params.id,
              '',
              [],
              payload.model,
              { thinkingLevel: 'off' },
              payload.baseHeadNodeId,
              null,
              {
                baseHeadNodeId: payload.baseHeadNodeId,
                startNodeId: payload.startNodeId,
                endNodeId: payload.endNodeId,
                instructions: payload.instructions,
              }
            )
          ),
          Effect.map(
            (response) =>
              new CompactRunResponse({
                status: response.status,
                runId: response.runId,
                baseNodeId: response.baseNodeId,
              })
          )
        )
      )
      .handle('stop', ({ params }) =>
        stopSession(storage, params.id).pipe(Effect.mapError(mapStorageError))
      )
  })
)
