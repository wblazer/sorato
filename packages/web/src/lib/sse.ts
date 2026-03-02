/**
 * SSE client — connects to the server's event stream.
 *
 * Uses native EventSource with automatic reconnection.
 * Emits typed ServerEvent objects via a callback.
 */
import type { ServerEvent } from '$lib/types.js'

const API_BASE = 'http://localhost:3100'

/** Known event tags that the server emits. */
const EVENT_TAGS = [
  'SessionUpdated',
  'MessagesAppended',
  'TextDelta',
  'ToolCall',
  'ToolResult',
  'RunStart',
  'RunEnd',
] as const

export interface SseConnection {
  /** Close the connection and stop reconnecting. */
  close(): void
  /** Whether the connection is currently open. */
  readonly connected: boolean
}

/**
 * Open an SSE connection to the server.
 *
 * @param onEvent - called for each parsed ServerEvent
 * @param sessionId - optional filter to only receive events for one session
 */
export function connectSse(
  onEvent: (event: ServerEvent) => void,
  sessionId?: string
): SseConnection {
  const url = new URL('/events', API_BASE)
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId)
  }

  let connected = false
  const es = new EventSource(url.toString())

  es.addEventListener('connected', () => {
    connected = true
  })

  // Register listeners for each event type
  for (const tag of EVENT_TAGS) {
    es.addEventListener(tag, (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ServerEvent
        onEvent(data)
      } catch {
        // Malformed event — skip
      }
    })
  }

  es.onerror = () => {
    connected = false
    // EventSource auto-reconnects
  }

  return {
    close() {
      es.close()
      connected = false
    },
    get connected() {
      return connected
    },
  }
}
