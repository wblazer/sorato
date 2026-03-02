/**
 * Messages store — fetches and streams messages for a session.
 *
 * Provides reactive state for the current session's message list.
 * Subscribes to SSE for real-time updates (text deltas, tool events).
 */
import type {
  MessageNode,
  ServerEvent,
  AssistantMessage,
  TextPart,
} from '$lib/types.js'
import { connectSse, type SseConnection } from '$lib/sse.js'

const API_BASE = 'http://localhost:3100'

function createMessagesStore() {
  let messages = $state<MessageNode[]>([])
  let loading = $state(false)
  let loaded = $state(false)
  let error = $state<string | null>(null)
  let currentSessionId = $state<string | null>(null)
  let sseConnection = $state<SseConnection | null>(null)

  // Accumulates streaming text deltas for the current assistant response.
  // Key: nothing (we just append to the last assistant message's last text part).
  let streamingText = $state('')
  let isStreaming = $state(false)

  async function loadMessages(sessionId: string) {
    // Disconnect previous SSE
    sseConnection?.close()
    sseConnection = null

    currentSessionId = sessionId
    loading = true
    loaded = false
    error = null
    streamingText = ''
    isStreaming = false

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

    // Connect SSE for this session
    sseConnection = connectSse(handleEvent, sessionId)
  }

  function handleEvent(event: ServerEvent) {
    switch (event._tag) {
      case 'RunStart':
        isStreaming = true
        streamingText = ''
        break

      case 'TextDelta':
        streamingText += event.delta
        break

      case 'ToolCall':
        // Could track pending tool calls — for now, just note it
        break

      case 'ToolResult':
        // Could update tool call status — for now, just note it
        break

      case 'RunEnd':
        isStreaming = false
        // Refresh messages to get the final persisted state
        if (currentSessionId) {
          refreshMessages(currentSessionId)
        }
        break

      case 'MessagesAppended':
        // New messages were persisted — refresh
        if (currentSessionId) {
          refreshMessages(currentSessionId)
        }
        break

      case 'SessionUpdated':
        // Session metadata changed (title, etc.) — could refresh session
        break
    }
  }

  /** Re-fetch messages without changing loading state (background refresh). */
  async function refreshMessages(sessionId: string) {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`)
      if (!res.ok) return
      const fresh: MessageNode[] = await res.json()
      if (currentSessionId === sessionId) {
        messages = fresh
      }
    } catch {
      // Silent failure for background refresh
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
    streamingText = ''
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
    get streamingText() {
      return streamingText
    },
    get isStreaming() {
      return isStreaming
    },
    loadMessages,
    clear,
  }
}

export const messagesStore = createMessagesStore()
