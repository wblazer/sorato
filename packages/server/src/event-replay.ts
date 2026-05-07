import type { ContentEvent } from './event-bus.ts'

export interface StreamCursor {
  readonly runId: string
  readonly eventId: number
}

interface ReplayState {
  readonly runId: string
  nextEventId: number
  readonly events: ContentEvent[]
}

type UnstampedContentEvent = ContentEvent extends infer Event
  ? Event extends ContentEvent
    ? Omit<Event, 'eventId'>
    : never
  : never

const buffers = new Map<string, ReplayState>()

const MAX_REPLAY_EVENTS = 5000

export function startEventReplay(sessionId: string, runId: string): void {
  buffers.set(sessionId, { runId, nextEventId: 1, events: [] })
}

export function appendReplayEvent(
  sessionId: string,
  runId: string,
  event: UnstampedContentEvent
): ContentEvent {
  const state = buffers.get(sessionId)
  if (!state || state.runId !== runId) {
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

export function endEventReplay(sessionId: string, runId: string): void {
  const state = buffers.get(sessionId)
  if (state?.runId === runId) {
    buffers.delete(sessionId)
  }
}

export function getReplaySnapshot(
  sessionId: string
): { readonly runId: string; readonly events: readonly ContentEvent[] } | null {
  const state = buffers.get(sessionId)
  if (!state) return null

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
  if (!state) return []

  if (!cursor || cursor.runId !== state.runId || cursor.eventId <= 0) {
    return state.events
  }

  return state.events.filter((event) => event.eventId > cursor.eventId)
}

export function resetEventReplay(): void {
  buffers.clear()
}
