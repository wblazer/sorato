/**
 * Global SSE store — one connection for the app's lifetime.
 *
 * Connects to `/events` (no sessionId filter) for the control-plane stream
 * only: session metadata updates and run lifecycle events across sessions.
 * Heavy per-session content is streamed separately by the messages store.
 *
 * Lifecycle:
 *   - `connect()` in the root layout's `$effect`
 *   - `disconnect()` in the layout's cleanup (page unload)
 *   - Stores call `onEvent()` at module init time to register handlers
 *
 * Session indicators (running/idle, title updates) stay live everywhere,
 * without fanning out full TextDelta / tool payloads to every client.
 */
import { Effect, Fiber, Stream } from 'effect'
import { serverEvents, type SseError } from '$lib/sse.js'
import type { ServerEvent } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'

type EventHandler = (event: ServerEvent) => void

function createSseStore() {
  let fiber: Fiber.Fiber<void, SseError> | null = null
  const listeners = new Set<EventHandler>()

  /**
   * Open the global SSE connection. Idempotent — calling twice is a no-op.
   * Should be called once from the root layout.
   */
  function connect() {
    if (fiber) return
    const apiBase = connectionsStore.getApiBase()
    if (!apiBase) return
    fiber = Effect.runFork(
      serverEvents(apiBase).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            for (const listener of listeners) {
              listener(event)
            }
          })
        )
      )
    )
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
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
    fiber = null
  }

  return {
    connect,
    onEvent,
    disconnect,
  }
}

export const sseStore = createSseStore()
