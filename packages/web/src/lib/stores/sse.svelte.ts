/**
 * Global SSE store — one connection for the app's lifetime.
 *
 * Connects to `/events` (no sessionId filter) so every event from every
 * session flows through. Individual stores subscribe and filter by
 * sessionId as needed.
 *
 * Lifecycle:
 *   - `connect()` in the root layout's `$effect`
 *   - `disconnect()` in the layout's cleanup (page unload)
 *   - Stores call `onEvent()` at module init time to register handlers
 *
 * This eliminates the per-session SSE teardown/reconnect dance entirely.
 * Navigation between sessions is just a filter change — no events lost.
 */
import { connectSse, type SseConnection } from '$lib/sse.js'
import type { ServerEvent } from '$lib/types.js'

type EventHandler = (event: ServerEvent) => void

function createSseStore() {
  let connection: SseConnection | null = null
  const listeners = new Set<EventHandler>()

  /**
   * Open the global SSE connection. Idempotent — calling twice is a no-op.
   * Should be called once from the root layout.
   */
  function connect() {
    if (connection) return
    connection = connectSse((event) => {
      for (const listener of listeners) {
        listener(event)
      }
    })
  }

  /**
   * Register a handler for all SSE events. Returns an unsubscribe function.
   * Handlers are called synchronously in registration order.
   */
  function onEvent(handler: EventHandler): () => void {
    listeners.add(handler)
    return () => listeners.delete(handler)
  }

  /** Close the global SSE connection. */
  function disconnect() {
    connection?.close()
    connection = null
  }

  return {
    connect,
    onEvent,
    disconnect,
  }
}

export const sseStore = createSseStore()
