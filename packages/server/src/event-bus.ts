/**
 * EventBus — in-process pub/sub for server events.
 *
 * Events flow from:
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
import { Context, Effect, Layer, PubSub, Scope, Stream } from 'effect'
import type { HarnessEvent } from '@sorato/core'
import {
  isContentEvent,
  type ContentEvent,
  type ServerEvent,
} from '@sorato/api'
import { appendReplayEvent } from './event-replay.ts'

export { isContentEvent, type ContentEvent, type ServerEvent }

// ---------------------------------------------------------------------------
// Bus service
// ---------------------------------------------------------------------------

export interface EventBusApi {
  readonly publish: (event: ServerEvent) => Effect.Effect<void>
  readonly subscribe: Effect.Effect<
    PubSub.Subscription<ServerEvent>,
    never,
    Scope.Scope
  >
  readonly stream: Stream.Stream<ServerEvent>
}

export class EventBus extends Context.Service<EventBus, EventBusApi>()(
  '@sorato/server/EventBus'
) {}

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const pubsub = yield* Effect.acquireRelease(
      PubSub.unbounded<ServerEvent>(),
      PubSub.shutdown
    )

    return EventBus.of({
      publish: (event) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
      subscribe: PubSub.subscribe(pubsub),
      stream: Stream.fromPubSub(pubsub),
    })
  })
)

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
export const createBusHook = Effect.fn('EventBus.createBusHook')(function* (
  sessionId: string,
  runId: string
) {
  const bus = yield* EventBus

  return {
    name: 'event-bus',
    handle: (event: HarnessEvent) =>
      Effect.gen(function* () {
        switch (event._tag) {
          case 'RunStart':
            // RunStart/RunEnd lifecycle events are published by server run
            // orchestration, not the harness hook.
            break
          case 'TextDelta':
            yield* bus.publish(
              yield* Effect.sync(() =>
                appendReplayEvent(sessionId, runId, {
                  _tag: 'TextDelta',
                  sessionId,
                  runId,
                  delta: event.delta,
                })
              )
            )
            break
          case 'ReasoningDelta':
            yield* bus.publish(
              yield* Effect.sync(() =>
                appendReplayEvent(sessionId, runId, {
                  _tag: 'ReasoningDelta',
                  sessionId,
                  runId,
                  delta: event.delta,
                })
              )
            )
            break
          case 'ToolCall':
            yield* bus.publish(
              yield* Effect.sync(() =>
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
            )
            break
          case 'ToolResult':
            yield* bus.publish(
              yield* Effect.sync(() =>
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
            )
            break
          case 'RunUsage':
            // Persistence-only event.
            break
          case 'ModelCallComplete':
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
  }
})
