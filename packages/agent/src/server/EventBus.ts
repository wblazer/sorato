/**
 * EventBus — in-process pub/sub for server events.
 *
 * Uses a plain EventEmitter for simplicity. Events flow from:
 *   - Harness hooks (via `createBusHook`)
 *   - Direct `publish()` calls (e.g. MessagesAppended from Agent.ts)
 *
 * To:
 *   - SSE connections (via `subscribe`)
 *   - RunState (via `subscribe`) — materializes running set + replay buffer
 *
 * Content events (TextDelta, ToolCall, ToolResult) carry a monotonic `seq`
 * per session, stamped by the bus hook. Clients use seq to deduplicate
 * replay-buffer events against live SSE events.
 *
 * Note: this is in-process only. If the harness runs in a different
 * process, events won't bridge.
 */
import { EventEmitter } from 'node:events'
import type { HarnessHook, HarnessEvent } from '../harness/harness.ts'
import { Effect } from 'effect'

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ServerEvent =
  | { readonly _tag: 'SessionUpdated'; readonly sessionId: string }
  | { readonly _tag: 'MessagesAppended'; readonly sessionId: string }
  | {
      readonly _tag: 'TextDelta'
      readonly sessionId: string
      readonly delta: string
      readonly seq: number
    }
  | {
      readonly _tag: 'ToolCall'
      readonly sessionId: string
      readonly id: string
      readonly name: string
      readonly params: unknown
      readonly seq: number
    }
  | {
      readonly _tag: 'ToolResult'
      readonly sessionId: string
      readonly id: string
      readonly name: string
      readonly result: unknown
      readonly isFailure: boolean
      readonly seq: number
    }
  | { readonly _tag: 'RunStart'; readonly sessionId: string }
  | { readonly _tag: 'RunEnd'; readonly sessionId: string }

// ---------------------------------------------------------------------------
// Bus singleton
// ---------------------------------------------------------------------------

const emitter = new EventEmitter()
emitter.setMaxListeners(100)

/** Publish an event to all subscribers. */
export function publish(event: ServerEvent): void {
  emitter.emit('event', event)
}

/** Subscribe to events. Returns an unsubscribe function. */
export function subscribe(listener: (event: ServerEvent) => void): () => void {
  emitter.on('event', listener)
  return () => emitter.off('event', listener)
}

// ---------------------------------------------------------------------------
// Sequence counters — monotonic per session, reset on RunStart
// ---------------------------------------------------------------------------

const seqCounters = new Map<string, number>()

/** Get the next seq for a session's current run. */
function nextSeq(sessionId: string): number {
  const seq = (seqCounters.get(sessionId) ?? 0) + 1
  seqCounters.set(sessionId, seq)
  return seq
}

/** Reset a session's seq counter (called on RunStart / RunEnd). */
function resetSeq(sessionId: string): void {
  seqCounters.delete(sessionId)
}

// ---------------------------------------------------------------------------
// Harness hook bridge
// ---------------------------------------------------------------------------

/**
 * Create a `HarnessHook` that forwards harness events to the event bus.
 *
 * Bind it to a sessionId so consumers know which session the events
 * belong to. Content events are stamped with a monotonic `seq`.
 */
export const createBusHook = (sessionId: string): HarnessHook => ({
  name: 'event-bus',
  handle: (event: HarnessEvent) =>
    Effect.sync(() => {
      switch (event._tag) {
        case 'RunStart':
          resetSeq(sessionId)
          publish({ _tag: 'RunStart', sessionId })
          break
        case 'TextDelta':
          publish({
            _tag: 'TextDelta',
            sessionId,
            delta: event.delta,
            seq: nextSeq(sessionId),
          })
          break
        case 'ToolCall':
          publish({
            _tag: 'ToolCall',
            sessionId,
            id: event.id,
            name: event.name,
            params: event.params,
            seq: nextSeq(sessionId),
          })
          break
        case 'ToolResult':
          publish({
            _tag: 'ToolResult',
            sessionId,
            id: event.id,
            name: event.name,
            result: event.result,
            isFailure: event.isFailure,
            seq: nextSeq(sessionId),
          })
          break
        case 'RunEnd':
          publish({ _tag: 'RunEnd', sessionId })
          resetSeq(sessionId)
          break
      }
    }),
})
