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
  readonly runId: string
  nextEventId: number
  readonly events: ContentEvent[]
}

interface FinishedReplayState {
  readonly status: 'completed' | 'failed'
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

export function startEventReplay(sessionId: string, runId: string): void {
  buffers.set(sessionId, {
    status: 'active',
    runId,
    nextEventId: 1,
    events: [],
  })
}

export function appendReplayEvent(
  sessionId: string,
  runId: string,
  event: UnstampedContentEvent
): ContentEvent {
  const state = buffers.get(sessionId)
  if (!state || state.status !== 'active' || state.runId !== runId) {
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
  const state = buffers.get(sessionId)
  if (state?.runId === runId) {
    buffers.set(sessionId, { status, runId, endedAt: Date.now() })
    trimFinishedStates()
  }
}

export function getReplaySnapshot(
  sessionId: string
): { readonly runId: string; readonly events: readonly ContentEvent[] } | null {
  const state = buffers.get(sessionId)
  if (!state || state.status !== 'active') return null

  return {
    runId: state.runId,
    events: [...state.events],
  }
}

export function getReplayBufferSince(
  sessionId: string,
  cursor: StreamCursor | undefined
): readonly ContentEvent[] {
  const state = buffers.get(sessionId)
  if (!state || state.status !== 'active') return []

  if (!cursor || cursor.runId !== state.runId || cursor.eventId <= 0) {
    return state.events
  }

  return state.events.filter((event) => event.eventId > cursor.eventId)
}

export function getReplayResetReason(
  sessionId: string,
  cursor: StreamCursor | undefined
): ReplayResetReason | null {
  if (!cursor) return null

  const state = buffers.get(sessionId)
  if (!state) return 'replay_unavailable'
  if (state.runId !== cursor.runId) return null

  if (state.status === 'completed') return 'run_completed'
  if (state.status === 'failed') return 'run_failed'

  if (!('events' in state)) return null

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

  for (const [sessionId] of finished.slice(0, -MAX_FINISHED_STATES)) {
    buffers.delete(sessionId)
  }
}

export function resetEventReplay(): void {
  buffers.clear()
}
