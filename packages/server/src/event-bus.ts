/**
 * EventBus — in-process pub/sub for server events.
 *
 * Uses a plain EventEmitter for simplicity. Events flow from:
 *   - Harness hooks (via `createBusHook`)
 *   - Direct `publish()` calls from server run orchestration
 *
 * To:
 *   - SSE connections (via `subscribe`)
 *   - Run registry + replay buffer (via `subscribe`) — materialized views for run control and SSE replay
 *
 * Content events (TextDelta, ReasoningDelta, ToolCall, ToolResult) carry a monotonic
 * `eventId` within a single `runId`. Session SSE streams use the pair as a
 * run-scoped replay cursor.
 *
 * Note: this is in-process only. If the harness runs in a different
 * process, events won't bridge.
 */
import { EventEmitter } from 'node:events'
import { Effect } from 'effect'
import type { HarnessEvent, HarnessHook } from '@sorato/core'
import {
  isContentEvent,
  type ContentEvent,
  type ServerEvent,
} from '@sorato/api'
import { appendReplayEvent } from './event-replay.ts'

export { isContentEvent, type ContentEvent, type ServerEvent }

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
 * belong to. Content events are stamped with a monotonic `eventId`
 * within the current run.
 */
export const createBusHook = (
  sessionId: string,
  runId: string
): HarnessHook => ({
  name: 'event-bus',
  handle: (event: HarnessEvent) =>
    Effect.sync(() => {
      switch (event._tag) {
        case 'RunStart':
          // RunStart/RunEnd lifecycle events are published by run-agent.ts
          // (which owns the run lifecycle), not the harness hook.
          break
        case 'TextDelta':
          publish(
            appendReplayEvent(sessionId, runId, {
              _tag: 'TextDelta',
              sessionId,
              runId,
              delta: event.delta,
            })
          )
          break
        case 'ReasoningDelta':
          publish(
            appendReplayEvent(sessionId, runId, {
              _tag: 'ReasoningDelta',
              sessionId,
              runId,
              delta: event.delta,
            })
          )
          break
        case 'ToolCall':
          publish(
            appendReplayEvent(sessionId, runId, {
              _tag: 'ToolCall',
              sessionId,
              runId,
              id: event.id,
              name: event.name,
              params: event.params,
              header: event.header,
            })
          )
          break
        case 'ToolResult':
          publish(
            appendReplayEvent(sessionId, runId, {
              _tag: 'ToolResult',
              sessionId,
              runId,
              id: event.id,
              name: event.name,
              result: event.result,
              header: event.header,
              bodyDisplay: event.bodyDisplay,
              isFailure: event.isFailure,
            })
          )
          break
        case 'RunUsage':
          // Persistence-only event.
          break
        case 'RunEnd':
          // See RunStart comment — lifecycle managed by run-agent.ts.
          break
        case 'RunResult':
          // Persistence is handled by the run persistence hook.
          break
      }
    }),
})
