/**
 * Messages store — fetches and streams messages for a session.
 *
 * Provides reactive state for the current session's message list.
 * Subscribes to SSE for real-time updates (text deltas, tool events).
 *
 * Streaming state tracks an array of parts — text, tool calls, tool
 * results — so the UI can render a continuous, uninterrupted stream.
 */
import type { MessageNode, MessagePart, ServerEvent } from '$lib/types.js'
import { connectSse, type SseConnection } from '$lib/sse.js'

const API_BASE = 'http://localhost:3100'

function createMessagesStore() {
  let messages = $state<MessageNode[]>([])
  let loading = $state(false)
  let loaded = $state(false)
  let error = $state<string | null>(null)
  let currentSessionId = $state<string | null>(null)
  let sseConnection = $state<SseConnection | null>(null)

  // Streaming state: an ordered list of parts as they arrive.
  // Text deltas accumulate into the last text part; tool calls and
  // results each become their own part entry.
  let streamingParts = $state<MessagePart[]>([])
  let isStreaming = $state(false)

  async function loadMessages(sessionId: string) {
    // Already connected to this session (e.g. new-session pre-connected
    // before the page transitioned to SessionView). Just fetch messages
    // without tearing down the SSE — events are already flowing.
    if (currentSessionId === sessionId && sseConnection) {
      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`)
        if (!res.ok) return
        messages = await res.json()
      } catch {
        // Silent — SSE is already handling live updates
      } finally {
        loading = false
        loaded = true
      }
      return
    }

    // Full setup: close previous, connect SSE, then fetch messages.
    sseConnection?.close()
    sseConnection = null

    currentSessionId = sessionId
    loading = true
    loaded = false
    error = null
    streamingParts = []
    isStreaming = false

    // Connect SSE FIRST — must be subscribed before any run starts,
    // otherwise events emitted during the fetch window are lost forever.
    sseConnection = connectSse(handleEvent, sessionId)

    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      messages = await res.json()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to fetch messages'
      messages = []
    } finally {
      loading = false
      loaded = true
    }
  }

  /**
   * Add an optimistic user message so it appears immediately.
   * The fake node is replaced by real data on the next refresh.
   */
  function addOptimisticUserMessage(sessionId: string, input: string) {
    const optimistic: MessageNode = {
      id: `optimistic-${Date.now()}`,
      sessionId,
      parentId: messages.length > 0 ? messages[messages.length - 1]!.id : null,
      encoded: { role: 'user', content: input },
      createdAt: Date.now(),
    }
    messages = [...messages, optimistic]
  }

  function handleEvent(event: ServerEvent) {
    switch (event._tag) {
      case 'RunStart':
        isStreaming = true
        streamingParts = []
        break

      case 'TextDelta': {
        // Append to the last text part, or create a new one.
        const last = streamingParts[streamingParts.length - 1]
        if (last && last.type === 'text') {
          // Svelte 5 reactivity needs a new array reference for the
          // mutation to propagate — clone the array with the updated part.
          streamingParts = [
            ...streamingParts.slice(0, -1),
            { type: 'text', text: last.text + event.delta },
          ]
        } else {
          streamingParts = [
            ...streamingParts,
            { type: 'text', text: event.delta },
          ]
        }
        break
      }

      case 'ToolCall':
        streamingParts = [
          ...streamingParts,
          {
            type: 'tool-call',
            id: event.id,
            name: event.name,
            params: event.params,
          },
        ]
        break

      case 'ToolResult':
        streamingParts = [
          ...streamingParts,
          {
            type: 'tool-result',
            id: event.id,
            name: event.name,
            result: event.result,
            isFailure: event.isFailure,
          },
        ]
        break

      case 'RunEnd':
        // Do NOT clear streaming state yet — keep it visible until the
        // refresh lands, avoiding the flash where streamed content
        // disappears before persisted messages arrive.
        if (currentSessionId) {
          refreshMessages(currentSessionId, { clearStreaming: true })
        }
        break

      case 'MessagesAppended':
        // New messages were persisted — refresh. Never clear streaming
        // here: the Phase 1 persist (user message) races with RunStart,
        // and the async refresh can resolve AFTER streaming has started,
        // stomping isStreaming back to false. Only RunEnd clears streaming.
        if (currentSessionId) {
          refreshMessages(currentSessionId)
        }
        break

      case 'SessionUpdated':
        // Session metadata changed (title, etc.) — could refresh session
        break
    }
  }

  /**
   * Re-fetch messages without changing loading state (background refresh).
   * When `clearStreaming` is true, streaming state is cleared after the
   * fetch resolves — this prevents the flash on RunEnd.
   */
  async function refreshMessages(
    sessionId: string,
    opts?: { clearStreaming?: boolean }
  ) {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`)
      if (!res.ok) return
      const fresh: MessageNode[] = await res.json()
      if (currentSessionId === sessionId) {
        messages = fresh
        if (opts?.clearStreaming) {
          isStreaming = false
          streamingParts = []
        }
      }
    } catch {
      // Silent failure for background refresh — still clear streaming
      // to avoid a permanently-stuck indicator.
      if (opts?.clearStreaming && currentSessionId === sessionId) {
        isStreaming = false
        streamingParts = []
      }
    }
  }

  function clear() {
    sseConnection?.close()
    sseConnection = null
    messages = []
    currentSessionId = null
    loading = false
    loaded = false
    error = null
    streamingParts = []
    isStreaming = false
  }

  return {
    get messages() {
      return messages
    },
    get loading() {
      return loading
    },
    get loaded() {
      return loaded
    },
    get error() {
      return error
    },
    get currentSessionId() {
      return currentSessionId
    },
    get streamingParts() {
      return streamingParts
    },
    get isStreaming() {
      return isStreaming
    },
    loadMessages,
    addOptimisticUserMessage,
    clear,
  }
}

export const messagesStore = createMessagesStore()
