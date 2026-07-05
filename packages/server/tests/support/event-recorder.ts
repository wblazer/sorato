import { Context, Deferred, Effect, Layer, PubSub, Ref, Stream } from 'effect'
import type { ServerEvent } from '@sorato/api'
import { EventBus, type EventBusApi } from '../../src/event-bus.ts'

export interface EventRecorderApi {
  readonly events: Effect.Effect<ReadonlyArray<ServerEvent>>
  readonly waitFor: (
    predicate: (event: ServerEvent) => boolean
  ) => Effect.Effect<ServerEvent>
  readonly eventsForRun: (
    runId: string
  ) => Effect.Effect<ReadonlyArray<ServerEvent>>
}

export class EventRecorder extends Context.Service<
  EventRecorder,
  EventRecorderApi
>()('@sorato/server/test/EventRecorder') {}

class RecordedEventEnvironment extends Context.Service<
  RecordedEventEnvironment,
  {
    readonly bus: EventBusApi
    readonly recorder: EventRecorderApi
  }
>()('@sorato/server/test/RecordedEventEnvironment') {}

interface Waiter {
  readonly predicate: (event: ServerEvent) => boolean
  readonly deferred: Deferred.Deferred<ServerEvent>
}

const publishToWaiters = (
  waitersRef: Ref.Ref<ReadonlyArray<Waiter>>,
  event: ServerEvent
) =>
  Ref.get(waitersRef).pipe(
    Effect.flatMap((waiters) => {
      const matching = waiters.filter((waiter) => waiter.predicate(event))
      if (matching.length === 0) return Effect.void

      const notifyMatching = Effect.forEach(
        matching,
        (waiter) => Deferred.succeed(waiter.deferred, event),
        { discard: true }
      )

      return Ref.set(
        waitersRef,
        waiters.filter((waiter) => !waiter.predicate(event))
      ).pipe(Effect.andThen(notifyMatching))
    })
  )

const makeRecorder = (
  eventsRef: Ref.Ref<ReadonlyArray<ServerEvent>>,
  waitersRef: Ref.Ref<ReadonlyArray<Waiter>>
) =>
  EventRecorder.of({
    events: Ref.get(eventsRef),
    waitFor: (predicate) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(eventsRef)).find(predicate)
        if (existing) return existing

        const deferred = yield* Deferred.make<ServerEvent>()
        yield* Ref.update(waitersRef, (waiters) => [
          ...waiters,
          { predicate, deferred },
        ])
        return yield* Deferred.await(deferred)
      }),
    eventsForRun: (runId) =>
      Ref.get(eventsRef).pipe(
        Effect.map((events) =>
          events.filter((event) => 'runId' in event && event.runId === runId)
        )
      ),
  })

const environmentLayer = Layer.effect(
  RecordedEventEnvironment,
  Effect.gen(function* () {
    const pubsub = yield* Effect.acquireRelease(
      PubSub.unbounded<ServerEvent>(),
      PubSub.shutdown
    )
    const eventsRef = yield* Ref.make<ReadonlyArray<ServerEvent>>([])
    const waitersRef = yield* Ref.make<ReadonlyArray<Waiter>>([])

    const bus = EventBus.of({
      publish: (event) =>
        Ref.update(eventsRef, (events) => [...events, event]).pipe(
          Effect.andThen(publishToWaiters(waitersRef, event))
        ),
      subscribe: PubSub.subscribe(pubsub),
      stream: Stream.fromPubSub(pubsub),
    })

    return RecordedEventEnvironment.of({
      bus,
      recorder: makeRecorder(eventsRef, waitersRef),
    })
  })
)

export const recordedEventBusLayer = Layer.merge(
  Layer.effect(
    EventBus,
    Effect.map(RecordedEventEnvironment, (environment) => environment.bus)
  ),
  Layer.effect(
    EventRecorder,
    Effect.map(RecordedEventEnvironment, (environment) => environment.recorder)
  )
).pipe(Layer.provide(environmentLayer))
