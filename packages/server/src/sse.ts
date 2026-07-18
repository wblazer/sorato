/**
 * SSE route — serves `/events` as a Server-Sent Events stream.
 *
 * Query params:
 *   - no params: global lifecycle stream
 *   - `runId`: stream/replay content and lifecycle for one active run
 *   - `since`: replay content events after the `runId:eventId` cursor
 *   - `sinceSequence`: replay durable sync events after a global sequence
 */
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect, Match, PubSub, Stream } from 'effect'
import { Api, isDurableServerEvent, type DurableServerEvent } from '@sorato/api'
import {
  isContentEvent,
  EventBus,
  type EventBusApi,
  type ContentEvent,
  type ServerEvent,
} from './event-bus.ts'
import {
  getReplayBufferSince,
  getReplayResetReason,
  getReplaySnapshot,
  type StreamCursor,
} from './event-replay.ts'
import { SessionStorage, type SessionStorageApi } from './session/session.ts'

function formatCursor(cursor: StreamCursor): string {
  return `${cursor.runId}:${cursor.eventId}`
}

function parseCursor(raw: string | null): StreamCursor | undefined {
  if (!raw) return undefined

  const separator = raw.lastIndexOf(':')
  if (separator <= 0) return undefined

  const runId = raw.slice(0, separator)
  const eventId = Number(raw.slice(separator + 1))
  if (!runId || !Number.isFinite(eventId)) return undefined

  return {
    runId,
    eventId: Math.max(0, Math.floor(eventId)),
  }
}

const connectedEvent = () =>
  `event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`

const formatContentEvent = (event: ContentEvent) =>
  `id: ${formatCursor({ runId: event.runId, eventId: event.eventId })}\nevent: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`

const formatLifecycleEvent = (event: Exclude<ServerEvent, ContentEvent>) =>
  `event: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`

const formatDurableEvent = (event: DurableServerEvent) =>
  `id: ${event.sequence}\nevent: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`

const formatEvent = Match.type<ServerEvent>().pipe(
  Match.tagsExhaustive({
    NodeBatchCommitted: formatDurableEvent,
    ActiveRunUpserted: formatDurableEvent,
    RunEnd: formatDurableEvent,
    RunFailed: formatLifecycleEvent,
    RunRetrying: formatLifecycleEvent,
    RunStart: formatLifecycleEvent,
    SessionTitleUpdated: formatDurableEvent,
    RunBaseUpdated: formatLifecycleEvent,
    ReplayReset: formatLifecycleEvent,
    ReasoningDelta: formatContentEvent,
    TextDelta: formatContentEvent,
    ToolCall: formatContentEvent,
    ToolResult: formatContentEvent,
  })
)

const isRunEvent =
  (runId: string) =>
  (event: ServerEvent): boolean =>
    'runId' in event && event.runId === runId

const isRunStreamEvent = (event: ServerEvent): boolean =>
  event._tag === 'RunStart' ||
  event._tag === 'RunEnd' ||
  event._tag === 'RunFailed' ||
  event._tag === 'RunRetrying' ||
  event._tag === 'ReplayReset' ||
  isContentEvent(event)

const liveGlobalStream = (
  bus: EventBusApi,
  storage: SessionStorageApi,
  sinceSequence: number
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* bus.subscribe
      const replay = yield* storage.durableEventsAfter(sinceSequence)
      let lastSequence = sinceSequence

      const formatGlobalEvent = (event: ServerEvent): ReadonlyArray<string> => {
        if (isContentEvent(event)) return []
        if (event._tag === 'RunStart' || event._tag === 'RunBaseUpdated') {
          return []
        }
        if (!isDurableServerEvent(event)) return [formatEvent(event)]
        if (event.sequence <= lastSequence) return []
        lastSequence = event.sequence
        return [formatEvent(event)]
      }

      const formatLiveGlobalEvent = (event: ServerEvent) => {
        if (
          !isDurableServerEvent(event) ||
          event.sequence <= lastSequence + 1
        ) {
          return Effect.succeed(formatGlobalEvent(event))
        }

        return storage
          .durableEventsAfter(lastSequence)
          .pipe(Effect.map((events) => events.flatMap(formatGlobalEvent)))
      }

      const prefix = [connectedEvent(), ...replay.flatMap(formatGlobalEvent)]

      return Stream.concat(
        Stream.fromIterable(prefix),
        Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
          Stream.mapEffect(formatLiveGlobalEvent),
          Stream.flatMap(Stream.fromIterable)
        )
      )
    })
  ).pipe(Stream.scoped)

const liveRunStream = (
  bus: EventBusApi,
  runId: string,
  cursor: StreamCursor | undefined
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* bus.subscribe

      let lastCursor = cursor
      let replayStartSent = false

      const formatRunContentEvent = (event: ContentEvent) => {
        const alreadyStreamed =
          lastCursor?.runId === event.runId &&
          event.eventId <= lastCursor.eventId

        if (alreadyStreamed) return []

        lastCursor = { runId: event.runId, eventId: event.eventId }
        return [formatEvent(event)]
      }

      const formatRunEvent = Match.type<ServerEvent>().pipe(
        Match.tagsExhaustive({
          NodeBatchCommitted: () => [],
          ActiveRunUpserted: () => [],
          RunEnd: (event) => [formatLifecycleEvent(event)],
          RunFailed: (event) => [formatEvent(event)],
          RunRetrying: (event) => [formatEvent(event)],
          RunStart: (event) =>
            replayStartSent && event.runId === runId
              ? []
              : [formatEvent(event)],
          SessionTitleUpdated: () => [],
          RunBaseUpdated: (event) => [formatEvent(event)],
          ReplayReset: (event) => [formatEvent(event)],
          ReasoningDelta: formatRunContentEvent,
          TextDelta: formatRunContentEvent,
          ToolCall: formatRunContentEvent,
          ToolResult: formatRunContentEvent,
        })
      )

      const replaySnapshot = getReplaySnapshot(runId)
      const replayStartEvent = [
        undefined,
        replaySnapshot && {
          _tag: 'RunStart' as const,
          sessionId: replaySnapshot.sessionId,
          runId,
          baseNodeId: replaySnapshot.baseNodeId,
          kind: replaySnapshot.kind,
          visibility: replaySnapshot.visibility,
          title: replaySnapshot.title,
          parentRunId: replaySnapshot.parentRunId,
          toolCallId: replaySnapshot.toolCallId,
        },
      ][Number(replaySnapshot !== null && cursor?.runId !== runId && true)]
      const resetReason = getReplayResetReason(runId, cursor)
      const replay = getReplayBufferSince(runId, cursor)
      const prefix: string[] = [connectedEvent()]

      resetReason &&
        cursor &&
        replaySnapshot &&
        prefix.push(
          formatEvent({
            _tag: 'ReplayReset',
            sessionId: replaySnapshot.sessionId,
            runId: cursor.runId,
            reason: resetReason,
            refetch: true,
          })
        )
      if (!resetReason && replayStartEvent) {
        replayStartSent = true
        prefix.push(formatEvent(replayStartEvent))
      }

      for (const event of replay) {
        prefix.push(...formatRunEvent(event))
      }

      return Stream.concat(
        Stream.fromIterable(prefix),
        Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
          Stream.filter(
            (event) => isRunEvent(runId)(event) && isRunStreamEvent(event)
          ),
          Stream.flatMap((event) => Stream.fromIterable(formatRunEvent(event)))
        )
      )
    })
  ).pipe(Stream.scoped)

const heartbeatStream = Stream.tick('5 seconds').pipe(
  Stream.map(() => ':heartbeat\n\n')
)

const makeSseStream = (
  bus: EventBusApi,
  storage: SessionStorageApi,
  runId: string | undefined,
  cursor: StreamCursor | undefined,
  sinceSequence: number
) =>
  (runId
    ? liveRunStream(bus, runId, cursor)
    : liveGlobalStream(bus, storage, sinceSequence)
  ).pipe(Stream.merge(heartbeatStream), Stream.encodeText)

export const EventsLive = HttpApiBuilder.group(Api, 'events', (handlers) =>
  handlers.handleRaw('stream', (context) => {
    const url = new URL(context.request.url, 'http://localhost')
    const runId = url.searchParams.get('runId') ?? undefined
    const cursor = parseCursor(url.searchParams.get('since'))
    const rawSinceSequence = Number(
      url.searchParams.get('sinceSequence') ??
        (runId === undefined
          ? (context.request.headers['last-event-id'] ?? 0)
          : 0)
    )
    const sinceSequence = Number.isFinite(rawSinceSequence)
      ? Math.max(0, Math.floor(rawSinceSequence))
      : 0

    return Effect.gen(function* () {
      const bus = yield* EventBus
      const storage = yield* SessionStorage
      yield* Effect.logInfo('SSE connection requested', {
        runId,
        hasCursor: cursor !== undefined,
        sinceSequence,
      })

      return HttpServerResponse.stream(
        makeSseStream(bus, storage, runId, cursor, sinceSequence),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }).pipe(Effect.annotateLogs({ package: 'server', subsystem: 'sse' }))
  })
)
