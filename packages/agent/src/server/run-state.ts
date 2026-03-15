/**
 * RunState — in-memory tracking of active agent runs.
 *
 * A materialized view of the event stream. Subscribes to the EventBus
 * and maintains two things:
 *
 * 1. **Running map** — which sessions have an active agent run, keyed
 *    by session ID → attached fiber (or a start claim before attachment).
 *    Fiber refs enable interruption from the stop endpoint.
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
import type { Fiber } from 'effect'
import { isContentEvent, subscribe, type ContentEvent } from './event-bus.ts'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const running = new Map<string, Fiber.RuntimeFiber<void, never> | null>()
const buffers = new Map<string, ContentEvent[]>()

/** Hard cap for per-session replay memory during a run. */
const MAX_REPLAY_EVENTS = 5000

// ---------------------------------------------------------------------------
// Bus subscription — maintains state from events
// ---------------------------------------------------------------------------

subscribe((event) => {
  switch (event._tag) {
    case 'RunStart':
      // Fiber is registered separately via `registerFiber()` — RunStart
      // only initialises the replay buffer. The fiber may already be set
      // (register happens before RunStart fires via hooks).
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
// Fiber registration
// ---------------------------------------------------------------------------

/**
 * Atomically reserve a session for a new run.
 *
 * Returns false when another run already owns the session.
 */
export function claimRun(sessionId: string): boolean {
  if (running.has(sessionId)) return false
  running.set(sessionId, null)
  return true
}

/**
 * Attach the fiber executing a session's agent run.
 *
 * Called from the HTTP handler after `forkDaemon`. The session is already
 * marked running via `claimRun()` before the fiber exists.
 */
export function registerFiber(
  sessionId: string,
  fiber: Fiber.RuntimeFiber<void, never>
): void {
  if (!running.has(sessionId)) {
    throw new Error(`Cannot register fiber for unclaimed session ${sessionId}`)
  }
  running.set(sessionId, fiber)
}

/** Release a claimed or running session. */
export function releaseRun(sessionId: string): void {
  running.delete(sessionId)
}

/**
 * Get the running fiber for a session (if any).
 */
export function getFiber(
  sessionId: string
): Fiber.RuntimeFiber<void, never> | undefined {
  return running.get(sessionId) ?? undefined
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Check if a session currently has an active agent run. */
export function isRunning(sessionId: string): boolean {
  return running.has(sessionId)
}

/** Get all currently-running session IDs. */
export function getRunningSessionIds(): ReadonlySet<string> {
  return new Set(running.keys())
}

/** Reset in-memory run state for tests. */
export function resetRunState(): void {
  running.clear()
  buffers.clear()
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
