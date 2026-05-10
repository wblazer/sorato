/**
 * SSE route — serves `/events` as a Server-Sent Events stream.
 *
 * Uses Effect HTTP's native `HttpServerResponse.stream` so the endpoint is a
 * normal router route rather than middleware that intercepts requests before
 * the API router.
 *
 * Query params:
 *   - `sessionId` (optional) — filter events to a specific session
 *   - `since` (optional, session streams only) — replay content events after
 *     the `runId:eventId` cursor before switching to live delivery
 */
import {
  HttpRouter,
  HttpServerResponse,
} from 'effect/unstable/http'
import { Effect, Match, Queue, Scope, Stream } from 'effect'
import {
  isContentEvent,
  subscribe,
  type ContentEvent,
  type ServerEvent,
} from './event-bus.ts'
import {
  getReplayBufferSince,
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
    RunStart: formatLifecycleEvent,
    SessionUpdated: formatLifecycleEvent,
    ReasoningDelta: formatContentEvent,
    TextDelta: formatContentEvent,
    ToolCall: formatContentEvent,
    ToolResult: formatContentEvent,
  })
)

const isSessionEvent = (sessionId: string) => (event: ServerEvent): boolean =>
  'sessionId' in event && event.sessionId === sessionId

const isSessionStreamEvent = (event: ServerEvent): boolean =>
  event._tag === 'RunStart' ||
  event._tag === 'RunEnd' ||
  event._tag === 'RunFailed' ||
  isContentEvent(event)

const liveGlobalStream = Stream.callback<string>((queue) =>
  Effect.gen(function* () {
    Queue.offerUnsafe(queue, connectedEvent())
    const unsubscribe = subscribe((event) => {
      isContentEvent(event) || Queue.offerUnsafe(queue, formatEvent(event))
    })
    const scope = yield* Scope.Scope
    yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe))
  })
)

const liveSessionStream = (
  sessionId: string,
  cursor: StreamCursor | undefined
) =>
  Stream.callback<string>((queue) =>
    Effect.gen(function* () {
      Queue.offerUnsafe(queue, connectedEvent())

      let lastCursor = cursor
      let replaying = true
      const pending: ServerEvent[] = []

      const writeSessionContentEvent = (event: ContentEvent) => {
        const alreadyStreamed =
          lastCursor?.runId === event.runId && event.eventId <= lastCursor.eventId

        if (alreadyStreamed) return

        lastCursor = { runId: event.runId, eventId: event.eventId }
        Queue.offerUnsafe(queue, formatEvent(event))
      }

      const writeSessionEvent = Match.type<ServerEvent>().pipe(
        Match.tagsExhaustive({
          MessagesAppended: (event) => Queue.offerUnsafe(queue, formatEvent(event)),
          RunEnd: (event) => Queue.offerUnsafe(queue, formatEvent(event)),
          RunFailed: (event) => Queue.offerUnsafe(queue, formatEvent(event)),
          RunStart: (event) => Queue.offerUnsafe(queue, formatEvent(event)),
          SessionUpdated: (event) => Queue.offerUnsafe(queue, formatEvent(event)),
          ReasoningDelta: writeSessionContentEvent,
          TextDelta: writeSessionContentEvent,
          ToolCall: writeSessionContentEvent,
          ToolResult: writeSessionContentEvent,
        })
      )

      const unsubscribe = subscribe((event) => {
        const isLiveSessionEvent =
          isSessionEvent(sessionId)(event) && isSessionStreamEvent(event)

        isLiveSessionEvent &&
          Match.value(replaying).pipe(
            Match.when(true, () => pending.push(event)),
            Match.orElse(() => writeSessionEvent(event))
          )
      })
      const scope = yield* Scope.Scope
      yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe))

      const pendingRunStartIds = new Set(
        pending
          .filter(
            (event): event is Extract<ServerEvent, { _tag: 'RunStart' }> =>
              event._tag === 'RunStart'
          )
          .map((event) => event.runId)
      )
      const replaySnapshot = getReplaySnapshot(sessionId)
      const replayRunId = replaySnapshot?.runId
      const replayStartEvent = [
        undefined,
        {
          _tag: 'RunStart' as const,
          sessionId,
          runId: replayRunId ?? '',
        },
      ][
        Number(
          replayRunId !== undefined &&
            cursor?.runId !== replayRunId &&
            !pendingRunStartIds.has(replayRunId)
        )
      ]
      const replay = getReplayBufferSince(sessionId, cursor)

      replayStartEvent && Queue.offerUnsafe(queue, formatEvent(replayStartEvent))

      replaying = false
      for (const event of [...replay, ...pending]) {
        writeSessionEvent(event)
      }
    })
  )

const heartbeatStream = Stream.tick('15 seconds').pipe(
  Stream.map(() => ':heartbeat\n\n')
)

const makeSseStream = (
  sessionId: string | undefined,
  cursor: StreamCursor | undefined
) =>
  (sessionId ? liveSessionStream(sessionId, cursor) : liveGlobalStream).pipe(
    Stream.merge(heartbeatStream),
    Stream.encodeText
  )

export const SseLive = HttpRouter.add('GET', '/events', (request) => {
  const url = new URL(request.url, 'http://localhost')
  const sessionId = url.searchParams.get('sessionId') ?? undefined
  const cursor = parseCursor(url.searchParams.get('since'))

  return Effect.logInfo('SSE connection requested', {
    sessionId,
    hasCursor: cursor !== undefined,
  }).pipe(
    Effect.map(() =>
      HttpServerResponse.stream(makeSseStream(sessionId, cursor), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      })
    ),
    Effect.annotateLogs({ package: 'server', subsystem: 'sse' })
  )
})
