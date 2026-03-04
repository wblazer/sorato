/**
 * RunState — in-memory tracking of active agent runs.
 *
 * A materialized view of the event stream. Subscribes to the EventBus
 * and maintains two things:
 *
 * 1. **Running set** — which sessions have an active agent run.
 * 2. **Replay buffer** — streaming content events (TextDelta, ToolCall,
 *    ToolResult) accumulated since RunStart, per session. When a client
 *    connects mid-run, the SSE middleware replays missed events by `eventId`.
 *
 * Both are ephemeral — lost on server restart, which is correct: if the
 * server restarts, no sessions are running. The persistent conversation
 * history lives in SessionStorage; this module only tracks the in-flight
 * turn that hasn't been persisted yet.
 *
 * Content events carry a monotonic per-session `eventId` (stamped by the bus
 * hook). Session streams use it as a cursor for replay and reconnect.
 */
import { isContentEvent, subscribe, type ContentEvent } from './EventBus.ts'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const running = new Set<string>()
const buffers = new Map<string, ContentEvent[]>()

/** Hard cap for per-session replay memory during a run. */
const MAX_REPLAY_EVENTS = 5000

// ---------------------------------------------------------------------------
// Bus subscription — maintains state from events
// ---------------------------------------------------------------------------

subscribe((event) => {
  switch (event._tag) {
    case 'RunStart':
      running.add(event.sessionId)
      buffers.set(event.sessionId, [])
      break

    case 'RunEnd':
      running.delete(event.sessionId)
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

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Check if a session currently has an active agent run. */
export function isRunning(sessionId: string): boolean {
  return running.has(sessionId)
}

/** Get all currently-running session IDs. */
export function getRunningSessionIds(): ReadonlySet<string> {
  return running
}

/**
 * Get a session replay slice — all content events with eventId > `afterEventId`.
 *
 * Returns an empty array if the session is not running.
 */
export function getReplayBufferSince(
  sessionId: string,
  afterEventId: number
): readonly ContentEvent[] {
  const buffer = buffers.get(sessionId)
  if (!buffer) return []

  if (afterEventId <= 0) return buffer

  return buffer.filter((event) => event.eventId > afterEventId)
}
