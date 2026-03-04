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
 * Content events (TextDelta, ToolCall, ToolResult) carry a monotonic
 * per-session `eventId`, stamped by the bus hook. Session SSE streams use
 * this cursor to replay missed events and continue live without gaps.
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
      readonly eventId: number
    }
  | {
      readonly _tag: 'ToolCall'
      readonly sessionId: string
      readonly id: string
      readonly name: string
      readonly params: unknown
      readonly eventId: number
    }
  | {
      readonly _tag: 'ToolResult'
      readonly sessionId: string
      readonly id: string
      readonly name: string
      readonly result: unknown
      readonly isFailure: boolean
      readonly eventId: number
    }
  | { readonly _tag: 'RunStart'; readonly sessionId: string }
  | { readonly _tag: 'RunEnd'; readonly sessionId: string }

export type ContentEvent = Extract<
  ServerEvent,
  { readonly _tag: 'TextDelta' | 'ToolCall' | 'ToolResult' }
>

export function isContentEvent(event: ServerEvent): event is ContentEvent {
  return (
    event._tag === 'TextDelta' ||
    event._tag === 'ToolCall' ||
    event._tag === 'ToolResult'
  )
}

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
// Event IDs — monotonic per session
// ---------------------------------------------------------------------------

const eventCounters = new Map<string, number>()

/** Get the next content event ID for a session. */
function nextEventId(sessionId: string): number {
  const eventId = (eventCounters.get(sessionId) ?? 0) + 1
  eventCounters.set(sessionId, eventId)
  return eventId
}

// ---------------------------------------------------------------------------
// Harness hook bridge
// ---------------------------------------------------------------------------

/**
 * Create a `HarnessHook` that forwards harness events to the event bus.
 *
 * Bind it to a sessionId so consumers know which session the events
 * belong to. Content events are stamped with a monotonic `eventId`.
 */
export const createBusHook = (sessionId: string): HarnessHook => ({
  name: 'event-bus',
  handle: (event: HarnessEvent) =>
    Effect.sync(() => {
      switch (event._tag) {
        case 'RunStart':
          publish({ _tag: 'RunStart', sessionId })
          break
        case 'TextDelta':
          publish({
            _tag: 'TextDelta',
            sessionId,
            delta: event.delta,
            eventId: nextEventId(sessionId),
          })
          break
        case 'ToolCall':
          publish({
            _tag: 'ToolCall',
            sessionId,
            id: event.id,
            name: event.name,
            params: event.params,
            eventId: nextEventId(sessionId),
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
            eventId: nextEventId(sessionId),
          })
          break
        case 'RunEnd':
          publish({ _tag: 'RunEnd', sessionId })
          break
      }
    }),
})
