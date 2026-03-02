/**
 * SSE middleware — intercepts `/events` and serves a Server-Sent Events stream.
 *
 * Implemented as HTTP middleware that short-circuits before the API router.
 * Uses native Web API `Response` + `ReadableStream` for the SSE body,
 * then wraps it via `HttpServerResponse.fromWeb` for @effect/platform.
 *
 * Query params:
 *   - `sessionId` (optional) — filter events to a specific session
 */
import {
  HttpMiddleware,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform'
import type { HttpApp } from '@effect/platform'
import { Effect } from 'effect'
import { subscribe, type ServerEvent } from './EventBus.ts'

// ---------------------------------------------------------------------------
// SSE response factory
// ---------------------------------------------------------------------------

function createSSEResponse(sessionId: string | null): globalThis.Response {
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
      // Initial connection event
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`
        )
      )

      // Subscribe to bus events
      unsubscribe = subscribe((event: ServerEvent) => {
        // Filter by sessionId if specified
        if (
          sessionId &&
          'sessionId' in event &&
          event.sessionId !== sessionId
        ) {
          return
        }
        try {
          const data = JSON.stringify(event)
          controller.enqueue(
            encoder.encode(`event: ${event._tag}\ndata: ${data}\n\n`)
          )
        } catch {
          // Stream closed — clean up
          cleanup()
        }
      })

      // Heartbeat every 15s to keep the connection alive
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          cleanup()
        }
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
          return HttpServerResponse.fromWeb(createSSEResponse(sessionId))
        }

        // Pass through to inner middleware + API
        return yield* inner(app)
      }) as HttpApp.Default<E, R>
  )
