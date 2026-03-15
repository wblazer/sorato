import { isContentEvent, subscribe, type ContentEvent } from './event-bus.ts'

const buffers = new Map<string, ContentEvent[]>()

const MAX_REPLAY_EVENTS = 5000

subscribe((event) => {
  switch (event._tag) {
    case 'RunStart':
      buffers.set(event.sessionId, [])
      break

    case 'RunEnd':
      buffers.delete(event.sessionId)
      break

    default:
      if (isContentEvent(event)) {
        const buffer = buffers.get(event.sessionId)
        if (!buffer) return

        buffer.push(event)
        if (buffer.length > MAX_REPLAY_EVENTS) {
          buffer.shift()
        }
      }
      break
  }
})

export function getReplayBufferSince(
  sessionId: string,
  afterEventId: number
): readonly ContentEvent[] {
  const buffer = buffers.get(sessionId)
  if (!buffer) return []

  if (afterEventId <= 0) return buffer

  return buffer.filter((event) => event.eventId > afterEventId)
}

export function resetEventReplay(): void {
  buffers.clear()
}
