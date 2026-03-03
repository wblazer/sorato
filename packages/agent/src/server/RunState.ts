/**
 * RunState — in-memory tracking of active agent runs.
 *
 * A materialized view of the event stream. Subscribes to the EventBus
 * and maintains two things:
 *
 * 1. **Running set** — which sessions have an active agent run.
 * 2. **Replay buffer** — streaming events (TextDelta, ToolCall, ToolResult)
 *    accumulated since RunStart, per session. When a client connects mid-run,
 *    it fetches the buffer to reconstruct the current streaming state.
 *
 * Both are ephemeral — lost on server restart, which is correct: if the
 * server restarts, no sessions are running. The persistent conversation
 * history lives in SessionStorage; this module only tracks the in-flight
 * turn that hasn't been persisted yet.
 *
 * Content events carry a monotonic `seq` number (stamped by the bus hook
 * via `nextSeq`) so clients can deduplicate events they received live
 * against events in the replay buffer.
 */
import { subscribe, type ServerEvent } from './EventBus.ts'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const running = new Set<string>()
const buffers = new Map<string, ServerEvent[]>()

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

    case 'TextDelta':
    case 'ToolCall':
    case 'ToolResult':
      buffers.get(event.sessionId)?.push(event)
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
 * Get the replay buffer for a session — all content events since RunStart.
 *
 * Returns an empty array if the session is not running.
 */
export function getReplayBuffer(sessionId: string): readonly ServerEvent[] {
  return buffers.get(sessionId) ?? []
}
