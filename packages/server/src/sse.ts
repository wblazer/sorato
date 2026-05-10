/**
 * SSE middleware — intercepts `/events` and serves a Server-Sent Events stream.
 *
 * Implemented as HTTP middleware that short-circuits before the API router.
 * Uses native Web API `Response` + `ReadableStream` for the SSE body,
 * then wraps it via `HttpServerResponse.fromWeb` for @effect/platform.
 *
 * Query params:
 *   - `sessionId` (optional) — filter events to a specific session
 *   - `since` (optional, session streams only) — replay content events after
 *     the `runId:eventId` cursor before switching to live delivery
 */
import {
  HttpMiddleware,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http'
import { Effect, Match } from 'effect'
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

// ---------------------------------------------------------------------------
// SSE response factory
// ---------------------------------------------------------------------------

function createSSEResponse(
  sessionId: string | undefined,
  cursor: StreamCursor | undefined
): globalThis.Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined

  const cleanup = () => {
    unsubscribe?.()
    unsubscribe = undefined
    heartbeatInterval && clearInterval(heartbeatInterval)
    heartbeatInterval = undefined
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const closeStream = () => {
        closed = true
        cleanup()
      }

      const write = (payload: string) => {
        if (closed) return
        Effect.runSync(
          Effect.try({
            try: () => controller.enqueue(encoder.encode(payload)),
            catch: () => undefined,
          }).pipe(
            Effect.match({
              onFailure: closeStream,
              onSuccess: () => undefined,
            })
          )
        )
      }

      const writeContentEvent = (event: ContentEvent) =>
        write(
          `id: ${formatCursor({ runId: event.runId, eventId: event.eventId })}\nevent: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`
        )

      const writeLifecycleEvent = (event: Exclude<ServerEvent, ContentEvent>) =>
        write(`event: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`)

      const writeEvent = Match.type<ServerEvent>().pipe(
        Match.tagsExhaustive({
          MessagesAppended: writeLifecycleEvent,
          RunEnd: writeLifecycleEvent,
          RunFailed: writeLifecycleEvent,
          RunStart: writeLifecycleEvent,
          SessionUpdated: writeLifecycleEvent,
          ReasoningDelta: writeContentEvent,
          TextDelta: writeContentEvent,
          ToolCall: writeContentEvent,
          ToolResult: writeContentEvent,
        })
      )

      // Initial connection event
      write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

      if (!sessionId) {
        // Global stream: control-plane events only.
        unsubscribe = subscribe((event: ServerEvent) => {
          isContentEvent(event) || writeEvent(event)
        })
      } else {
        // Session stream: replay content since cursor, then continue live.
        let lastCursor = cursor
        let replaying = true
        const pending: ServerEvent[] = []

        const writeSessionContentEvent = (
          event: Extract<
            ServerEvent,
            { _tag: 'TextDelta' | 'ReasoningDelta' | 'ToolCall' | 'ToolResult' }
          >
        ) => {
          const alreadyStreamed =
            lastCursor?.runId === event.runId &&
            event.eventId <= lastCursor.eventId

          if (alreadyStreamed) return

          lastCursor = { runId: event.runId, eventId: event.eventId }
          writeEvent(event)
        }

        const isSessionEvent = (event: ServerEvent): boolean =>
          'sessionId' in event && event.sessionId === sessionId

        const isSessionStreamEvent = (event: ServerEvent): boolean =>
          event._tag === 'RunStart' ||
          event._tag === 'RunEnd' ||
          event._tag === 'RunFailed' ||
          isContentEvent(event)

        const writeSessionEvent = Match.type<ServerEvent>().pipe(
          Match.tagsExhaustive({
            MessagesAppended: writeEvent,
            RunEnd: writeEvent,
            RunFailed: writeEvent,
            RunStart: writeEvent,
            SessionUpdated: writeEvent,
            ReasoningDelta: writeSessionContentEvent,
            TextDelta: writeSessionContentEvent,
            ToolCall: writeSessionContentEvent,
            ToolResult: writeSessionContentEvent,
          })
        )

        unsubscribe = subscribe((event: ServerEvent) => {
          const isLiveSessionEvent =
            isSessionEvent(event) && isSessionStreamEvent(event)

          isLiveSessionEvent &&
            Match.value(replaying).pipe(
              Match.when(true, () => pending.push(event)),
              Match.orElse(() => writeSessionEvent(event))
            )
        })

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

        replayStartEvent && writeEvent(replayStartEvent)

        replaying = false
        for (const event of [...replay, ...pending]) {
          writeSessionEvent(event)
        }
      }

      // Heartbeat every 15s to keep the connection alive
      heartbeatInterval = setInterval(() => {
        write(':heartbeat\n\n')
      }, 15_000)
    },
    cancel() {
      cleanup()
    },
  })

  return new globalThis.Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Compose with another middleware (typically `HttpMiddleware.logger`).
 *
 * Usage in main.ts:
 * ```ts
 * HttpApiBuilder.serve(withSse(HttpMiddleware.logger))
 * ```
 */
// oxlint-disable sorato/no-manual-effect-channels -- middleware wrapper must preserve the generic Effect channels it receives
export const withSse = (
  inner: <E, R>(
    app: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      HttpServerRequest.HttpServerRequest | R
    >
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    HttpServerRequest.HttpServerRequest | R
  >
) =>
  HttpMiddleware.make(
    <E, R>(
      app: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        E,
        HttpServerRequest.HttpServerRequest | R
      >
    ) =>
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(req.url, 'http://localhost')

        const eventResponse = Effect.suspend(() => {
          const sessionId = url.searchParams.get('sessionId') ?? undefined
          const cursor = parseCursor(url.searchParams.get('since'))
          return Effect.logInfo('SSE connection requested', {
            sessionId,
            hasCursor: cursor !== undefined,
          }).pipe(
            Effect.map(() =>
              HttpServerResponse.fromWeb(createSSEResponse(sessionId, cursor))
            )
          )
        })

        return yield* Match.value(url.pathname).pipe(
          Match.when('/events', () => eventResponse),
          Match.orElse(() => inner(app))
        )
      }).pipe(Effect.annotateLogs({ package: 'server', subsystem: 'sse' }))
  )
// oxlint-enable sorato/no-manual-effect-channels
