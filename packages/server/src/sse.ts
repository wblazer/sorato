/**
 * SSE route — serves `/events` as a Server-Sent Events stream.
 *
 * Query params:
 *   - no params: global lifecycle stream
 *   - `runId`: stream/replay content and lifecycle for one active run
 *   - `since`: replay content events after the `runId:eventId` cursor
 */
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect, Match, PubSub, Stream } from 'effect'
import { Api } from '@sorato/api'
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

const formatEvent = Match.type<ServerEvent>().pipe(
  Match.tagsExhaustive({
    MessagesAppended: formatLifecycleEvent,
    RunEnd: formatLifecycleEvent,
    RunFailed: formatLifecycleEvent,
    RunRetrying: formatLifecycleEvent,
    RunStart: formatLifecycleEvent,
    SessionUpdated: formatLifecycleEvent,
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

const liveGlobalStream = (bus: EventBusApi) =>
  Stream.concat(
    Stream.make(connectedEvent()),
    bus.stream.pipe(
      Stream.filter((event) => !isContentEvent(event)),
      Stream.map(formatEvent)
    )
  )

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
          MessagesAppended: (event) => [formatEvent(event)],
          RunEnd: (event) => [formatEvent(event)],
          RunFailed: (event) => [formatEvent(event)],
          RunRetrying: (event) => [formatEvent(event)],
          RunStart: (event) =>
            replayStartSent && event.runId === runId
              ? []
              : [formatEvent(event)],
          SessionUpdated: (event) => [formatEvent(event)],
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
  runId: string | undefined,
  cursor: StreamCursor | undefined
) =>
  (runId ? liveRunStream(bus, runId, cursor) : liveGlobalStream(bus)).pipe(
    Stream.merge(heartbeatStream),
    Stream.encodeText
  )

export const EventsLive = HttpApiBuilder.group(Api, 'events', (handlers) =>
  handlers.handleRaw('stream', (context) => {
    const url = new URL(context.request.url, 'http://localhost')
    const runId = url.searchParams.get('runId') ?? undefined
    const cursor = parseCursor(url.searchParams.get('since'))

    return Effect.gen(function* () {
      const bus = yield* EventBus
      yield* Effect.logInfo('SSE connection requested', {
        runId,
        hasCursor: cursor !== undefined,
      })

      return HttpServerResponse.stream(makeSseStream(bus, runId, cursor), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }).pipe(Effect.annotateLogs({ package: 'server', subsystem: 'sse' }))
  })
)
