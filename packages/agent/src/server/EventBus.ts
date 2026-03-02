/**
 * EventBus — in-process pub/sub for server events.
 *
 * Uses a plain EventEmitter for simplicity. Events flow from:
 *   - Harness hooks (via `createBusHook`)
 *   - Storage mutations (when we add them)
 *
 * To:
 *   - SSE connections (via `subscribe`)
 *
 * Note: this is in-process only. If the harness runs in a different
 * process, events won't bridge. The natural next step is running the
 * harness within the server process, at which point this Just Works.
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
    }
  | {
      readonly _tag: 'ToolCall'
      readonly sessionId: string
      readonly id: string
      readonly name: string
      readonly params: unknown
    }
  | {
      readonly _tag: 'ToolResult'
      readonly sessionId: string
      readonly id: string
      readonly name: string
      readonly result: unknown
      readonly isFailure: boolean
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
// Harness hook bridge
// ---------------------------------------------------------------------------

/**
 * Create a `HarnessHook` that forwards harness events to the event bus.
 *
 * Bind it to a sessionId so consumers know which session the events
 * belong to.
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
          publish({ _tag: 'TextDelta', sessionId, delta: event.delta })
          break
        case 'ToolCall':
          publish({
            _tag: 'ToolCall',
            sessionId,
            id: event.id,
            name: event.name,
            params: event.params,
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
          })
          break
        case 'RunEnd':
          publish({ _tag: 'RunEnd', sessionId })
          break
      }
    }),
})
