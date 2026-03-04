/**
 * Messages store — streaming content and persisted messages for the
 * active session.
 *
 * Uses a session-scoped SSE stream for heavy content events
 * (TextDelta/ToolCall/ToolResult). The stream is opened when a session is
 * viewed and closed when leaving/switching.
 *
 * Running state lives in the session store (single source of truth for
 * all sessions). This store tracks streaming *content* — the parts
 * accumulating for the in-flight turn — and the persisted message list.
 * Components derive "is running" from the session store and decide how
 * to render (pulsing indicators vs static content) based on that.
 *
 * Correctness comes from a single channel for streaming content:
 * `/events?sessionId=...&since=...`.
 *
 * The server replays events newer than `since` and then switches to live
 * delivery on the same connection. No separate stream-state fetch means no
 * overlap/gap race at the replay/live boundary.
 */
import type { MessageNode, MessagePart } from '$lib/types.js'
import { connectSse, type SseConnection } from '$lib/sse.js'

const API_BASE = 'http://localhost:3100'

function createMessagesStore() {
  let messages = $state<MessageNode[]>([])
  let loading = $state(false)
  let loaded = $state(false)
  let error = $state<string | null>(null)
  let currentSessionId = $state<string | null>(null)

  // Streaming content: the in-flight turn's parts as they arrive.
  // Cleared when the run ends and persisted messages replace it.
  let streamingParts = $state<MessagePart[]>([])

  // Cursor of the last streamed content event seen per session.
  // Used for catch-up when (re)opening a session stream.
  const lastEventIds = new Map<string, number>()

  let streamConnection: SseConnection | null = null

  const getLastEventId = (sessionId: string) => lastEventIds.get(sessionId) ?? 0

  const setLastEventId = (sessionId: string, eventId: number) => {
    const prev = getLastEventId(sessionId)
    if (eventId > prev) {
      lastEventIds.set(sessionId, eventId)
    }
  }

  function closeSessionStream() {
    streamConnection?.close()
    streamConnection = null
  }

  function openSessionStream(sessionId: string) {
    closeSessionStream()

    streamConnection = connectSse(
      (event) => {
        if (!('sessionId' in event) || event.sessionId !== currentSessionId)
          return

        switch (event._tag) {
          case 'RunStart':
            streamingParts = []
            // User message is persisted before run starts; refresh to show it.
            refreshMessages(sessionId)
            break

          case 'TextDelta':
            setLastEventId(sessionId, event.eventId)
            appendTextDelta(event.delta)
            break

          case 'ToolCall':
            setLastEventId(sessionId, event.eventId)
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
            setLastEventId(sessionId, event.eventId)
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
            // Refresh messages to pick up the persisted conversation.
            // Streaming parts stay visible until the refresh lands.
            refreshMessages(sessionId, { clearParts: true })
            break

          case 'MessagesAppended':
          case 'SessionUpdated':
            // Not emitted on session-scoped streams.
            break
        }
      },
      {
        sessionId,
        getSince: () => getLastEventId(sessionId),
      }
    )
  }

  // ── Text delta accumulation ─────────────────────────────────────

  function appendTextDelta(delta: string) {
    const last = streamingParts[streamingParts.length - 1]
    if (last && last.type === 'text') {
      streamingParts = [
        ...streamingParts.slice(0, -1),
        { type: 'text', text: last.text + delta },
      ]
    } else {
      streamingParts = [...streamingParts, { type: 'text', text: delta }]
    }
  }

  // ── Loading ─────────────────────────────────────────────────────

  /**
   * Prepare the store for a new session without fetching.
   *
   * Sets `currentSessionId` so SSE events flow, marks the store as
   * loaded so the UI renders immediately. Used by the new-session
   * flow: the caller adds an optimistic message after this, and
   * SSE events drive all subsequent updates. SessionView's
   * `loadMessages` sees the session is already set up and does a
   * background refresh instead of a full load.
   */
  function prepareSession(sessionId: string) {
    messages = []
    currentSessionId = sessionId
    loading = false
    loaded = true
    error = null
    streamingParts = []
    openSessionStream(sessionId)
  }

  /**
   * Load persisted messages for a session.
   *
   * If `currentSessionId` is already set for this session (e.g. via
   * `prepareSession`), does a background refresh — no loading indicator,
   * existing messages preserved until the server catches up.
   */
  async function loadMessages(sessionId: string) {
    const hasExisting = currentSessionId === sessionId && messages.length > 0

    // Reset current turn parts when changing sessions.
    streamingParts = []
    error = null

    if (!hasExisting) {
      loading = true
      loaded = false
    }

    currentSessionId = sessionId
    openSessionStream(sessionId)

    try {
      const messagesRes = await fetch(
        `${API_BASE}/sessions/${sessionId}/messages`
      )

      if (currentSessionId !== sessionId) return

      if (!messagesRes.ok)
        throw new Error(`${messagesRes.status} ${messagesRes.statusText}`)

      const serverMessages: MessageNode[] = await messagesRes.json()

      // During a background refresh, the server might not have caught
      // up yet (e.g. the run's Phase 1 hasn't persisted the user
      // message). Keep existing messages (including optimistic ones)
      // until the server has real data.
      if (hasExisting && serverMessages.length === 0) {
        // Server hasn't caught up — keep what we have
      } else {
        messages = serverMessages
      }
    } catch (e) {
      if (currentSessionId !== sessionId) return
      error = e instanceof Error ? e.message : 'Failed to fetch messages'
      messages = []
    } finally {
      if (currentSessionId === sessionId) {
        loading = false
        loaded = true
      }
    }
  }

  /**
   * Add an optimistic user message so it appears immediately.
   * Replaced by real data on the next refresh.
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

  /**
   * Re-fetch messages (background, no loading indicator).
   * When `clearParts` is true, streaming parts are cleared after the
   * fetch — used on RunEnd to atomically swap streaming content for
   * persisted messages.
   */
  async function refreshMessages(
    sessionId: string,
    opts?: { clearParts?: boolean }
  ) {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`)
      if (!res.ok) return
      const fresh: MessageNode[] = await res.json()
      if (currentSessionId === sessionId) {
        messages = fresh
        if (opts?.clearParts) {
          streamingParts = []
        }
      }
    } catch {
      if (opts?.clearParts && currentSessionId === sessionId) {
        streamingParts = []
      }
    }
  }

  /** Reset all state. Called when SessionView unmounts. */
  function clear() {
    closeSessionStream()
    messages = []
    currentSessionId = null
    loading = false
    loaded = false
    error = null
    streamingParts = []
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
    prepareSession,
    loadMessages,
    addOptimisticUserMessage,
    clear,
  }
}

export const messagesStore = createMessagesStore()
