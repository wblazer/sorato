import type { ContentEvent } from './event-bus.ts'

export interface StreamCursor {
  readonly runId: string
  readonly eventId: number
}

export type ReplayResetReason =
  | 'run_completed'
  | 'run_failed'
  | 'replay_unavailable'
  | 'replay_gap'

interface ActiveReplayState {
  readonly status: 'active'
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly kind: 'agent' | 'summary'
  readonly visibility: 'primary' | 'background'
  readonly title: string | undefined
  readonly parentRunId: string | undefined
  readonly toolCallId: string | undefined
  nextEventId: number
  readonly events: ContentEvent[]
}

interface FinishedReplayState {
  readonly status: 'completed' | 'failed'
  readonly sessionId: string
  readonly runId: string
  readonly endedAt: number
}

type ReplayState = ActiveReplayState | FinishedReplayState

type UnstampedContentEvent = ContentEvent extends infer Event
  ? Event extends ContentEvent
    ? Omit<Event, 'eventId'>
    : never
  : never

const buffers = new Map<string, ReplayState>()

const MAX_REPLAY_EVENTS = 5000
const MAX_FINISHED_STATES = 1000

export function startEventReplay(
  sessionId: string,
  runId: string,
  baseNodeId: string | null = null,
  kind: 'agent' | 'summary' = 'agent',
  options: {
    readonly visibility?: 'primary' | 'background'
    readonly title?: string
    readonly parentRunId?: string
    readonly toolCallId?: string
  } = {}
): void {
  buffers.set(runId, {
    status: 'active',
    sessionId,
    runId,
    baseNodeId,
    kind,
    visibility: options.visibility ?? 'primary',
    title: options.title,
    parentRunId: options.parentRunId,
    toolCallId: options.toolCallId,
    nextEventId: 1,
    events: [],
  })
}

export function appendReplayEvent(
  sessionId: string,
  runId: string,
  event: UnstampedContentEvent
): ContentEvent {
  const state = buffers.get(runId)
  if (!state || state.status !== 'active' || state.sessionId !== sessionId) {
    throw new Error(
      `No active replay state for session ${sessionId} and run ${runId}`
    )
  }

  const replayEvent = { ...event, eventId: state.nextEventId++ }
  state.events.push(replayEvent)
  if (state.events.length > MAX_REPLAY_EVENTS) {
    state.events.shift()
  }

  return replayEvent
}

export function endEventReplay(
  sessionId: string,
  runId: string,
  status: 'completed' | 'failed' = 'completed'
): void {
  const state = buffers.get(runId)
  if (state?.runId === runId) {
    buffers.set(runId, { status, sessionId, runId, endedAt: Date.now() })
    trimFinishedStates()
  }
}

export function getReplaySnapshot(runId: string): {
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly kind: 'agent' | 'summary'
  readonly visibility: 'primary' | 'background'
  readonly title: string | undefined
  readonly parentRunId: string | undefined
  readonly toolCallId: string | undefined
  readonly events: readonly ContentEvent[]
} | null {
  const state = buffers.get(runId)
  if (!state || state.status !== 'active') return null

  return {
    sessionId: state.sessionId,
    runId: state.runId,
    baseNodeId: state.baseNodeId,
    kind: state.kind,
    visibility: state.visibility,
    title: state.title,
    parentRunId: state.parentRunId,
    toolCallId: state.toolCallId,
    events: [...state.events],
  }
}

export function getContentThroughEventId(runId: string): number | undefined {
  const state = buffers.get(runId)
  if (!state || state.status !== 'active' || state.nextEventId <= 1) {
    return undefined
  }
  return state.nextEventId - 1
}

export function getActiveBackgroundReplayRuns(
  sessionId: string
): ReadonlyArray<{
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly kind: 'agent' | 'summary'
  readonly visibility: 'background'
  readonly title: string | undefined
  readonly parentRunId: string | undefined
  readonly toolCallId: string | undefined
}> {
  return [...buffers.values()].flatMap((state) =>
    state.status === 'active' &&
    state.sessionId === sessionId &&
    state.visibility === 'background'
      ? [
          {
            sessionId: state.sessionId,
            runId: state.runId,
            baseNodeId: state.baseNodeId,
            kind: state.kind,
            visibility: state.visibility,
            title: state.title,
            parentRunId: state.parentRunId,
            toolCallId: state.toolCallId,
          },
        ]
      : []
  )
}

export function getReplayBufferSince(
  runId: string,
  cursor: StreamCursor | undefined
): readonly ContentEvent[] {
  const state = buffers.get(runId)
  if (!state || state.status !== 'active') return []

  if (!cursor || cursor.runId !== state.runId || cursor.eventId <= 0) {
    return state.events
  }

  return state.events.filter((event) => event.eventId > cursor.eventId)
}

export function getReplayResetReason(
  runId: string,
  cursor: StreamCursor | undefined
): ReplayResetReason | null {
  if (!cursor) return null

  const state = buffers.get(runId)
  if (!state) return 'replay_unavailable'
  if (state.runId !== cursor.runId) return null

  if (state.status === 'completed') return 'run_completed'
  if (state.status === 'failed') return 'run_failed'
  if (state.status !== 'active') return null

  const oldestEventId = state.events[0]?.eventId
  if (
    oldestEventId !== undefined &&
    cursor.eventId > 0 &&
    cursor.eventId < oldestEventId - 1
  ) {
    return 'replay_gap'
  }

  return null
}

function trimFinishedStates(): void {
  const finished = [...buffers.entries()]
    .filter(
      (entry): entry is [string, FinishedReplayState] =>
        entry[1].status !== 'active'
    )
    .sort((left, right) => left[1].endedAt - right[1].endedAt)

  for (const [runId] of finished.slice(0, -MAX_FINISHED_STATES)) {
    buffers.delete(runId)
  }
}

export function resetEventReplay(): void {
  buffers.clear()
}
