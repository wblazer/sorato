import type { Fiber } from 'effect'
import type { ModelOptions } from './model-catalog.ts'

export interface CompactRangeRun {
  readonly baseHeadNodeId: string
  readonly startNodeId: string
  readonly endNodeId: string
  readonly instructions?: string | undefined
}

export interface RunAttachment {
  readonly mediaType: string
  readonly fileName: string
  readonly data: string
  readonly size: number
}

export interface RunInput {
  readonly text: string
  readonly attachments: ReadonlyArray<RunAttachment>
}

export interface RunRequest {
  readonly runId: string
  readonly inputs: ReadonlyArray<RunInput>
  readonly model: string
  readonly modelOptions: ModelOptions
  readonly baseNodeId: string | null
  readonly afterRunId: string | null
  readonly compactRange?: CompactRangeRun | undefined
}

export interface ActiveRunInfo {
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly kind: 'agent' | 'summary'
  readonly visibility: 'primary' | 'background'
  readonly parentRunId: string | undefined
  readonly toolCallId: string | undefined
}

interface RunQueueState {
  readonly id: string
  readonly sessionId: string
  workerFiber: Fiber.Fiber<void, never> | Fiber.Fiber<void, unknown> | null
  activeRunFiber: Fiber.Fiber<void, never> | null
  activeRunId: string | null
  activeBaseNodeId: string | null
  activeRunKind: 'agent' | 'summary'
  activeRunVisibility: 'primary' | 'background'
  parentRunId: string | undefined
  toolCallId: string | undefined
  activeRunRequest: RunRequest | null
  startingRun: RunRequest | null
  queuedRuns: Array<RunRequest>
  stopRequestedRunIds: Set<string>
}

const queues = new Map<string, RunQueueState>()
const runQueues = new Map<string, string>()
const childRunParents = new Map<string, string>()
const childRunToolCallIds = new Map<string, string | undefined>()

const missingQueueState = (kind: string, queueId: string): never => {
  throw new Error(`Cannot register ${kind} for unknown run queue ${queueId}`)
}

const sameRunBatch = (a: RunRequest, b: RunRequest) =>
  a.compactRange === undefined &&
  b.compactRange === undefined &&
  a.model === b.model &&
  a.baseNodeId === b.baseNodeId &&
  a.afterRunId === b.afterRunId &&
  JSON.stringify(a.modelOptions) === JSON.stringify(b.modelOptions)

const queueRunState = (state: RunQueueState, request: RunRequest) => {
  const last = state.queuedRuns.at(-1)
  if (last && sameRunBatch(last, request)) {
    state.queuedRuns[state.queuedRuns.length - 1] = {
      ...last,
      inputs: [...last.inputs, ...request.inputs],
    }
    return { status: 'queued' as const, runId: last.runId, queueId: state.id }
  }

  state.queuedRuns.push(request)
  runQueues.set(request.runId, state.id)
  return { status: 'queued' as const, runId: request.runId, queueId: state.id }
}

export function startRunQueue(
  sessionId: string,
  request: RunRequest
): {
  readonly status: 'started'
  readonly runId: string
  readonly queueId: string
} {
  const queueId = request.runId
  queues.set(queueId, {
    id: queueId,
    sessionId,
    workerFiber: null,
    activeRunFiber: null,
    activeRunId: null,
    activeBaseNodeId: null,
    activeRunKind: 'agent',
    activeRunVisibility: 'primary',
    parentRunId: undefined,
    toolCallId: undefined,
    activeRunRequest: null,
    startingRun: null,
    queuedRuns: [request],
    stopRequestedRunIds: new Set(),
  })
  runQueues.set(request.runId, queueId)
  return { status: 'started' as const, runId: request.runId, queueId }
}

export function enqueueRun(
  sessionId: string,
  request: RunRequest,
  targetRunId?: string
): {
  readonly status: 'started' | 'queued'
  readonly runId: string
  readonly queueId: string
} {
  const targetQueueId = targetRunId ? runQueues.get(targetRunId) : undefined
  const targetQueue = targetQueueId ? queues.get(targetQueueId) : undefined
  if (targetQueue && targetQueue.sessionId === sessionId) {
    return queueRunState(targetQueue, request)
  }

  return startRunQueue(sessionId, request)
}

export function registerWorkerFiber(
  queueId: string,
  fiber: Fiber.Fiber<void, never> | Fiber.Fiber<void, unknown>
): void {
  const state = queues.get(queueId) ?? missingQueueState('worker', queueId)
  state.workerFiber = fiber
}

export function registerActiveFiber(
  queueId: string,
  runId: string,
  baseNodeId: string | null,
  kind: 'agent' | 'summary',
  visibility: 'primary' | 'background',
  fiber: Fiber.Fiber<void, never>,
  request: RunRequest | null = null
): void {
  const state = queues.get(queueId) ?? missingQueueState('active run', queueId)
  state.activeRunFiber = fiber
  state.activeRunId = runId
  state.activeBaseNodeId = baseNodeId
  state.activeRunKind = kind
  state.activeRunVisibility = visibility
  state.activeRunRequest = request
  const parentRunId = childRunParents.get(runId)
  if (parentRunId !== undefined) {
    state.parentRunId = parentRunId
    state.toolCallId = childRunToolCallIds.get(runId)
  }
  runQueues.set(runId, queueId)
}

export function updateActiveRunParent(
  childRunId: string,
  parentRunId: string,
  toolCallId?: string | undefined
): void {
  childRunParents.set(childRunId, parentRunId)
  childRunToolCallIds.set(childRunId, toolCallId)

  const queueId = runQueues.get(childRunId) ?? runQueues.get(parentRunId)
  if (queueId === undefined) return
  const state = queues.get(queueId)
  if (!state) return
  runQueues.set(childRunId, queueId)

  if (
    state.activeRunId === childRunId ||
    state.startingRun?.runId === childRunId
  ) {
    state.parentRunId = parentRunId
    state.toolCallId = toolCallId
  }
}

export function clearActiveRunParent(childRunId: string): void {
  childRunParents.delete(childRunId)
  childRunToolCallIds.delete(childRunId)
  if (runQueues.has(childRunId)) {
    const queueId = runQueues.get(childRunId)
    const state = queueId ? queues.get(queueId) : undefined
    if (
      state?.activeRunId !== childRunId &&
      state?.startingRun?.runId !== childRunId
    ) {
      runQueues.delete(childRunId)
    }
  }
}

export function updateActiveRunBase(
  runId: string,
  baseNodeId: string | null
): void {
  const queueId = runQueues.get(runId)
  const state = queueId ? queues.get(queueId) : undefined
  if (!state || state.activeRunId !== runId) return
  state.activeBaseNodeId = baseNodeId
}

export function clearActiveFiber(queueId: string): void {
  const state = queues.get(queueId)
  if (!state) return
  state.activeRunFiber = null
  state.activeRunId = null
  state.activeBaseNodeId = null
  state.activeRunKind = 'agent'
  state.activeRunVisibility = 'primary'
  state.parentRunId = undefined
  state.toolCallId = undefined
  state.activeRunRequest = null
}

export function shiftQueuedRun(queueId: string): RunRequest | undefined {
  const state = queues.get(queueId)
  const request = state?.queuedRuns.shift()
  if (state && request) state.startingRun = request
  return request
}

export function clearStartingRun(queueId: string, runId: string): void {
  const state = queues.get(queueId)
  if (state?.startingRun?.runId === runId) state.startingRun = null
}

export function requestStop(sessionId: string): void {
  for (const state of queues.values()) {
    if (state.sessionId !== sessionId) continue
    if (state.activeRunId !== null)
      state.stopRequestedRunIds.add(state.activeRunId)
    if (state.startingRun !== null)
      state.stopRequestedRunIds.add(state.startingRun.runId)
    for (const request of state.queuedRuns) {
      state.stopRequestedRunIds.add(request.runId)
    }
  }
}

export function requestRunStop(runId: string): void {
  const queueId = runQueues.get(runId)
  const state = queueId ? queues.get(queueId) : undefined
  if (!state) return
  state.stopRequestedRunIds.add(runId)
}

export function shouldStop(queueId: string): boolean {
  const state = queues.get(queueId)
  if (!state) return false
  return (
    (state.activeRunId !== null &&
      state.stopRequestedRunIds.has(state.activeRunId)) ||
    (state.startingRun !== null &&
      state.stopRequestedRunIds.has(state.startingRun.runId))
  )
}

export function shouldStopRun(runId: string): boolean {
  const queueId = runQueues.get(runId)
  const state = queueId ? queues.get(queueId) : undefined
  return state?.stopRequestedRunIds.has(runId) ?? false
}

export function drainQueuedRuns(sessionId: string): Array<RunRequest> {
  const queued: Array<RunRequest> = []
  for (const state of queues.values()) {
    if (state.sessionId !== sessionId) continue
    queued.push(...state.queuedRuns)
    state.queuedRuns = []
  }
  return queued
}

export interface RunStopSnapshot {
  readonly sessionId: string
  readonly queueId: string
  readonly runId: string
  readonly activeFiber: Fiber.Fiber<void, never> | null
  readonly workerFiber:
    | Fiber.Fiber<void, never>
    | Fiber.Fiber<void, unknown>
    | null
  readonly isActive: boolean
  readonly startingRun: RunRequest | null
  readonly activeRunRequest: RunRequest | null
  readonly queuedRuns: ReadonlyArray<RunRequest>
  readonly parentRunId: string | undefined
  readonly childRunIds: ReadonlyArray<string>
}

export function getRunStopSnapshot(runId: string): RunStopSnapshot | undefined {
  const queueId = runQueues.get(runId)
  if (queueId === undefined) return undefined
  const state = queues.get(queueId)
  if (!state) return undefined

  const startingRun =
    state.startingRun?.runId === runId ? state.startingRun : null
  const queuedRuns = state.queuedRuns.filter(
    (request) => request.runId === runId
  )
  const registryChildRunIds = [...queues.values()]
    .filter((candidate) => candidate.parentRunId === runId)
    .map((candidate) => candidate.activeRunId ?? candidate.startingRun?.runId)
    .filter((id): id is string => id !== undefined && id !== null)
  const childRunIds = [
    ...new Set([
      ...registryChildRunIds,
      ...[...childRunParents.entries()]
        .filter(([, parentRunId]) => parentRunId === runId)
        .map(([childRunId]) => childRunId),
    ]),
  ]

  return {
    sessionId: state.sessionId,
    queueId,
    runId,
    activeFiber: state.activeRunId === runId ? state.activeRunFiber : null,
    workerFiber: state.workerFiber,
    isActive: state.activeRunId === runId && state.activeRunFiber !== null,
    activeRunRequest:
      state.activeRunId === runId ? state.activeRunRequest : null,
    startingRun,
    queuedRuns,
    parentRunId: state.parentRunId,
    childRunIds,
  }
}
export function clearRunMapping(runId: string): void {
  runQueues.delete(runId)
}

export function drainQueuedRunsForRun(runId: string): Array<RunRequest> {
  const queueId = runQueues.get(runId)
  const state = queueId ? queues.get(queueId) : undefined
  if (!state) return []

  const drained: Array<RunRequest> = []
  state.queuedRuns = state.queuedRuns.filter((request) => {
    if (request.runId !== runId) return true
    drained.push(request)
    return false
  })
  return drained
}

export function takeStartingRun(runId: string): RunRequest | undefined {
  const queueId = runQueues.get(runId)
  const state = queueId ? queues.get(queueId) : undefined
  if (state?.startingRun?.runId !== runId) return undefined
  const request = state.startingRun
  state.startingRun = null
  return request
}

export function releaseRunQueue(queueId: string): void {
  const state = queues.get(queueId)
  if (!state) return
  for (const [runId, mappedQueueId] of runQueues) {
    if (mappedQueueId === queueId) runQueues.delete(runId)
  }
  queues.delete(queueId)
}

export function getFibers(
  sessionId: string
): ReadonlyArray<Fiber.Fiber<void, never>> {
  return [...queues.values()].flatMap((state) =>
    state.sessionId === sessionId && state.activeRunFiber
      ? [state.activeRunFiber]
      : []
  )
}

export function isRunning(sessionId: string): boolean {
  return [...queues.values()].some((state) => state.sessionId === sessionId)
}

export function isRunActive(runId: string): boolean {
  const queueId = runQueues.get(runId)
  const state = queueId ? queues.get(queueId) : undefined
  return state?.activeRunId === runId && state.activeRunFiber !== null
}

export function isRunRegistered(runId: string): boolean {
  return runQueues.has(runId)
}

export function getQueuedRunCount(sessionId: string): number {
  return [...queues.values()]
    .filter((state) => state.sessionId === sessionId)
    .reduce((count, state) => count + state.queuedRuns.length, 0)
}

export function getActiveRuns(sessionId: string): ReadonlyArray<ActiveRunInfo> {
  return [...queues.values()].flatMap((state) =>
    state.sessionId === sessionId && state.activeRunId !== null
      ? [
          {
            sessionId,
            runId: state.activeRunId,
            baseNodeId: state.activeBaseNodeId,
            kind: state.activeRunKind,
            visibility: state.activeRunVisibility,
            parentRunId: state.parentRunId,
            toolCallId: state.toolCallId,
          },
        ]
      : []
  )
}

export function getRunningSessionIds(): ReadonlySet<string> {
  return new Set([...queues.values()].map((state) => state.sessionId))
}

export function resetRunRegistry(): void {
  queues.clear()
  runQueues.clear()
  childRunParents.clear()
  childRunToolCallIds.clear()
}
