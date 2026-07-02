/**
 * SSE client — typed Effect stream for the server event stream.
 */
import { Cause, Effect, Queue, Schedule, Schema, Scope, Stream } from 'effect'
import { ServerEvent } from '@sorato/api'
import type {
  ServerEvent as ServerEventType,
  StreamCursor,
} from '$lib/types.js'

const ServerEventJson = Schema.fromJsonString(ServerEvent)
const decodeServerEvent = Schema.decodeUnknownOption(ServerEventJson)

/** Known event tags that the server emits. */
const EVENT_TAGS = [
  'SessionUpdated',
  'MessagesAppended',
  'TextDelta',
  'ReasoningDelta',
  'ToolCall',
  'ToolResult',
  'RunStart',
  'RunEnd',
  'RunBaseUpdated',
  'RunRetrying',
  'RunFailed',
  'ReplayReset',
] as const

export class SseConnectionError extends Schema.TaggedErrorClass<SseConnectionError>()(
  'SseConnectionError',
  {
    message: Schema.String,
  }
) {}

export class SseDecodeError extends Schema.TaggedErrorClass<SseDecodeError>()(
  'SseDecodeError',
  {
    event: Schema.String,
    message: Schema.String,
  }
) {}

export type SseError = SseConnectionError | SseDecodeError

export interface ServerEventStreamOptions {
  /** Filter events to one run. Omit for global control stream. */
  readonly runId?: string
  /** Cursor getter used when opening/reconnecting a run stream. */
  readonly getSince?: () => StreamCursor | null
}

function formatCursor(cursor: StreamCursor): string {
  return `${cursor.runId}:${cursor.eventId}`
}

function buildUrl(apiBase: string, options: ServerEventStreamOptions) {
  const url = new URL('/events', apiBase)
  if (options.runId) {
    url.searchParams.set('runId', options.runId)
    const cursor = options.getSince?.()
    if (cursor) url.searchParams.set('since', formatCursor(cursor))
  }
  return url
}

const rawServerEvents = (apiBase: string, options: ServerEventStreamOptions) =>
  Stream.callback<ServerEventType, SseError>((queue) =>
    Effect.gen(function* () {
      const eventSource = new EventSource(buildUrl(apiBase, options).toString())

      eventSource.addEventListener('connected', () => {
        // The server sends this as a transport-level readiness signal only.
      })

      for (const tag of EVENT_TAGS) {
        eventSource.addEventListener(tag, (event: MessageEvent) => {
          const decoded = decodeServerEvent(event.data)
          if (decoded._tag === 'Some') {
            Queue.offerUnsafe(queue, decoded.value as ServerEventType)
            return
          }

          Queue.failCauseUnsafe(
            queue,
            Cause.fail(
              new SseDecodeError({
                event: tag,
                message: 'Invalid SSE event payload',
              })
            )
          )
        })
      }

      eventSource.onerror = () => {
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(new SseConnectionError({ message: 'SSE connection lost' }))
        )
      }

      const scope = yield* Scope.Scope
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          eventSource.close()
        })
      )
    })
  )

export function serverEvents(
  apiBase: string,
  options: ServerEventStreamOptions = {}
) {
  return rawServerEvents(apiBase, options).pipe(
    Stream.retry(Schedule.spaced('500 millis'))
  )
}
