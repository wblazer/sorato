/**
 * SSE client — connects to the server's event stream.
 *
 * Uses native EventSource with reconnect handled in this module.
 * Emits typed ServerEvent objects via a callback.
 */
import { Schema } from 'effect'
import { ServerEvent } from '@sorato/api'
import type {
  ServerEvent as ServerEventType,
  StreamCursor,
} from '$lib/types.js'

const decodeServerEvent = Schema.decodeUnknownOption(ServerEvent)

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
  'RunFailed',
  'ReplayReset',
] as const

export interface SseConnection {
  /** Close the connection and stop reconnecting. */
  close(): void
  /** Whether the connection is currently open. */
  readonly connected: boolean
}

export interface ConnectSseOptions {
  /** Filter events to one run. Omit for global control stream. */
  runId?: string
  /** Cursor getter used when opening/reconnecting a run stream. */
  getSince?: () => StreamCursor | null
}

function formatCursor(cursor: StreamCursor): string {
  return `${cursor.runId}:${cursor.eventId}`
}

/**
 * Open an SSE connection to the server.
 *
 * @param apiBase - the base URL of the server (e.g., 'http://localhost:3100')
 * @param onEvent - called for each parsed ServerEvent
 * @param options - session filter and replay cursor hook
 */
export function connectSse(
  apiBase: string,
  onEvent: (event: ServerEventType) => void,
  options: ConnectSseOptions = {}
): SseConnection {
  let connected = false
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let es: EventSource | null = null

  const buildUrl = () => {
    const url = new URL('/events', apiBase)
    if (options.runId) {
      url.searchParams.set('runId', options.runId)
      const cursor = options.getSince?.()
      if (cursor) {
        url.searchParams.set('since', formatCursor(cursor))
      }
    }
    return url
  }

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      open()
    }, 500)
  }

  const open = () => {
    if (closed) return

    es = new EventSource(buildUrl().toString())

    es.addEventListener('connected', () => {
      connected = true
    })

    for (const tag of EVENT_TAGS) {
      es.addEventListener(tag, (e: MessageEvent) => {
        try {
          const data = decodeServerEvent(JSON.parse(e.data))
          if (data._tag === 'Some') onEvent(data.value as ServerEventType)
        } catch {
          // Malformed event — skip
        }
      })
    }

    es.onerror = () => {
      connected = false
      es?.close()
      es = null
      scheduleReconnect()
    }
  }

  open()

  return {
    close() {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      es?.close()
      es = null
      connected = false
    },
    get connected() {
      return connected
    },
  }
}
