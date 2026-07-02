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
}

interface RunQueueState {
  readonly id: string
  readonly sessionId: string
  workerFiber: Fiber.Fiber<void, never> | null
  activeRunFiber: Fiber.Fiber<void, never> | null
  activeRunId: string | null
  activeBaseNodeId: string | null
  activeRunKind: 'agent' | 'summary'
  activeRunVisibility: 'primary' | 'background'
  queuedRuns: Array<RunRequest>
  stopRequested: boolean
}

const queues = new Map<string, RunQueueState>()
const runQueues = new Map<string, string>()

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
    queuedRuns: [request],
    stopRequested: false,
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
  fiber: Fiber.Fiber<void, never>
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
  fiber: Fiber.Fiber<void, never>
): void {
  const state = queues.get(queueId) ?? missingQueueState('active run', queueId)
  state.activeRunFiber = fiber
  state.activeRunId = runId
  state.activeBaseNodeId = baseNodeId
  state.activeRunKind = kind
  state.activeRunVisibility = visibility
  runQueues.set(runId, queueId)
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
}

export function shiftQueuedRun(queueId: string): RunRequest | undefined {
  return queues.get(queueId)?.queuedRuns.shift()
}

export function requestStop(sessionId: string): void {
  for (const state of queues.values()) {
    if (state.sessionId === sessionId) state.stopRequested = true
  }
}

export function shouldStop(queueId: string): boolean {
  return queues.get(queueId)?.stopRequested ?? false
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
}
