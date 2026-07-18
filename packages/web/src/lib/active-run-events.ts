import type { ActiveRunSummary, ServerEvent } from '$lib/types.js'

type ActiveRunUpsertedEvent = Extract<
  ServerEvent,
  { readonly _tag: 'ActiveRunUpserted' }
>

export const activeRunFromUpserted = (
  event: ActiveRunUpsertedEvent
): ActiveRunSummary => ({
  sessionId: event.sessionId,
  runId: event.runId,
  baseNodeId: event.baseNodeId,
  kind: event.kind,
  visibility: event.visibility,
  ...(event.title === undefined ? {} : { title: event.title }),
  ...(event.parentRunId === undefined
    ? {}
    : { parentRunId: event.parentRunId }),
  ...(event.toolCallId === undefined ? {} : { toolCallId: event.toolCallId }),
})

export interface RunQueueEntry {
  readonly runId: string
}

export interface ActiveRunCollections<T extends RunQueueEntry> {
  readonly activeRuns: ReadonlyMap<string, ActiveRunSummary>
  readonly pendingRunStarts: ReadonlyMap<string, number>
  readonly queuedMessages: ReadonlyMap<string, ReadonlyArray<T>>
}

export interface ActiveRunUpsertResult<T extends RunQueueEntry> {
  readonly inserted: boolean
  readonly activeRuns: Map<string, ActiveRunSummary>
  readonly pendingRunStarts: Map<string, number>
  readonly queuedMessages: Map<string, T[]>
}

export const upsertActiveRun = <T extends RunQueueEntry>(
  state: ActiveRunCollections<T>,
  run: ActiveRunSummary
): ActiveRunUpsertResult<T> => {
  const inserted = !state.activeRuns.has(run.runId)
  const activeRuns = new Map(state.activeRuns)
  activeRuns.set(run.runId, run)

  const pendingRunStarts = new Map(state.pendingRunStarts)
  if (inserted) {
    const pendingStarts = pendingRunStarts.get(run.sessionId) ?? 0
    if (pendingStarts <= 1) pendingRunStarts.delete(run.sessionId)
    else pendingRunStarts.set(run.sessionId, pendingStarts - 1)
  }

  const queuedMessages = new Map<string, T[]>()
  for (const [sessionId, entries] of state.queuedMessages) {
    queuedMessages.set(sessionId, [...entries])
  }
  const queued = queuedMessages.get(run.sessionId) ?? []
  const remaining = queued.filter((draft) => draft.runId !== run.runId)
  if (remaining.length === 0) queuedMessages.delete(run.sessionId)
  else queuedMessages.set(run.sessionId, remaining)

  return {
    inserted,
    activeRuns,
    pendingRunStarts,
    queuedMessages,
  }
}

export const removeActiveRun = (
  activeRuns: ReadonlyMap<string, ActiveRunSummary>,
  runId: string
): Map<string, ActiveRunSummary> => {
  const next = new Map(activeRuns)
  next.delete(runId)
  return next
}

export const sessionHasRunWork = <T extends RunQueueEntry>(
  state: ActiveRunCollections<T>,
  sessionId: string
): boolean =>
  [...state.activeRuns.values()].some((run) => run.sessionId === sessionId) ||
  (state.pendingRunStarts.get(sessionId) ?? 0) > 0 ||
  (state.queuedMessages.get(sessionId)?.length ?? 0) > 0
