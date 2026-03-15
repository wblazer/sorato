/**
 * SSE middleware — intercepts `/events` and serves a Server-Sent Events stream.
 *
 * Implemented as HTTP middleware that short-circuits before the API router.
 * Uses native Web API `Response` + `ReadableStream` for the SSE body,
 * then wraps it via `HttpServerResponse.fromWeb` for @effect/platform.
 *
 * Query params:
 *   - `sessionId` (optional) — filter events to a specific session
 *   - `since` (optional, session streams only) — replay content events with
 *     `eventId > since` before switching to live delivery
 */
import {
  HttpMiddleware,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform'
import type { HttpApp } from '@effect/platform'
import { Effect } from 'effect'
import { isContentEvent, subscribe, type ServerEvent } from './event-bus.ts'
import { getReplayBufferSince } from './event-replay.ts'
import { isRunning } from './run-registry.ts'

// ---------------------------------------------------------------------------
// SSE response factory
// ---------------------------------------------------------------------------

function createSSEResponse(
  sessionId: string | null,
  afterEventId: number
): globalThis.Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null

  const cleanup = () => {
    unsubscribe?.()
    unsubscribe = null
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const write = (payload: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          closed = true
          cleanup()
        }
      }

      const writeEvent = (event: ServerEvent) => {
        if (isContentEvent(event)) {
          write(
            `id: ${event.eventId}\nevent: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`
          )
          return
        }

        write(`event: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`)
      }

      // Initial connection event
      write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

      if (!sessionId) {
        // Global stream: control-plane events only.
        unsubscribe = subscribe((event: ServerEvent) => {
          if (isContentEvent(event)) return
          writeEvent(event)
        })
      } else {
        // Session stream: replay content since cursor, then continue live.
        let lastEventId = afterEventId
        let replaying = true
        const pending: ServerEvent[] = []

        const isSessionEvent = (event: ServerEvent): boolean =>
          'sessionId' in event && event.sessionId === sessionId

        const isSessionStreamEvent = (event: ServerEvent): boolean =>
          event._tag === 'RunStart' ||
          event._tag === 'RunEnd' ||
          isContentEvent(event)

        const writeSessionEvent = (event: ServerEvent) => {
          if (!isContentEvent(event)) {
            writeEvent(event)
            return
          }

          if (event.eventId <= lastEventId) return
          lastEventId = event.eventId
          writeEvent(event)
        }

        unsubscribe = subscribe((event: ServerEvent) => {
          if (!isSessionEvent(event) || !isSessionStreamEvent(event)) return

          if (replaying) {
            pending.push(event)
            return
          }

          writeSessionEvent(event)
        })

        if (isRunning(sessionId)) {
          const replay = getReplayBufferSince(sessionId, afterEventId)
          for (const event of replay) {
            writeSessionEvent(event)
          }
        }

        replaying = false
        for (const event of pending) {
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
export const withSse = (
  inner: <E, R>(app: HttpApp.Default<E, R>) => HttpApp.Default<E, R>
) =>
  HttpMiddleware.make(
    <E, R>(app: HttpApp.Default<E, R>): HttpApp.Default<E, R> =>
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(req.url, 'http://localhost')

        if (url.pathname === '/events') {
          const sessionId = url.searchParams.get('sessionId')
          const sinceRaw = Number(url.searchParams.get('since') ?? '0')
          const afterEventId = Number.isFinite(sinceRaw)
            ? Math.max(0, Math.floor(sinceRaw))
            : 0
          return HttpServerResponse.fromWeb(
            createSSEResponse(sessionId, afterEventId)
          )
        }

        // Pass through to inner middleware + API
        return yield* inner(app)
      }) as HttpApp.Default<E, R>
  )
