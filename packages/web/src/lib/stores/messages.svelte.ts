/**
 * Messages store — streaming content and persisted messages for the
 * active session.
 *
 * Receives events from the global SSE store (no per-session connections).
 * Filters by `currentSessionId` — navigating between sessions is just
 * a filter change, no SSE teardown/reconnect.
 *
 * Running state lives in the session store (single source of truth for
 * all sessions). This store tracks streaming *content* — the parts
 * accumulating for the in-flight turn — and the persisted message list.
 * Components derive "is running" from the session store and decide how
 * to render (pulsing indicators vs static content) based on that.
 *
 * When joining a running session (page load, navigation), the store
 * fetches the replay buffer from `/stream-state` and replays it to
 * reconstruct streaming content. A `seq` dedup mechanism prevents
 * double-counting events from both replay and live SSE.
 *
 * After replaying, we synchronously check `sessionStore.isRunning()`.
 * If a RunEnd arrived during the fetch, the session store already
 * knows — the stale replay is discarded immediately. No manual
 * generation counters; the session store is always correct.
 */
import type {
  MessageNode,
  MessagePart,
  ServerEvent,
  StreamState,
} from '$lib/types.js'
import { sseStore } from './sse.svelte.js'
import { sessionStore } from './sessions.svelte.js'

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

  // Dedup: highest seq from the replay buffer. Live events with
  // seq <= this value were already replayed and should be skipped.
  let replaySeq = 0

  // ── Global SSE subscription ─────────────────────────────────────

  sseStore.onEvent((event) => {
    if (!('sessionId' in event) || event.sessionId !== currentSessionId) return

    // Dedup content events already covered by replay
    if ('seq' in event && event.seq <= replaySeq) return

    switch (event._tag) {
      case 'RunStart':
        streamingParts = []
        replaySeq = 0
        break

      case 'TextDelta':
        appendTextDelta(event.delta)
        break

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
        // Refresh messages to pick up the persisted conversation.
        // Streaming parts stay visible until the refresh lands —
        // clearParts: true ensures they're removed atomically with
        // the fresh messages, preventing the flash.
        if (currentSessionId) {
          refreshMessages(currentSessionId, { clearParts: true })
        }
        break

      case 'MessagesAppended':
        if (currentSessionId) {
          refreshMessages(currentSessionId)
        }
        break
    }
  })

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

  // ── Replay buffer → streaming parts ─────────────────────────────

  function replayEvents(events: ServerEvent[]) {
    // Reset — the replay buffer is the authoritative source for all
    // content up to its max seq.
    streamingParts = []
    replaySeq = 0

    for (const event of events) {
      switch (event._tag) {
        case 'TextDelta':
          appendTextDelta(event.delta)
          if (event.seq > replaySeq) replaySeq = event.seq
          break
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
          if (event.seq > replaySeq) replaySeq = event.seq
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
          if (event.seq > replaySeq) replaySeq = event.seq
          break
      }
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
    replaySeq = 0
  }

  /**
   * Load messages and stream state for a session.
   *
   * If `currentSessionId` is already set for this session (e.g. via
   * `prepareSession`), does a background refresh — no loading indicator,
   * existing messages preserved until the server catches up.
   */
  async function loadMessages(sessionId: string) {
    const hasExisting = currentSessionId === sessionId && messages.length > 0

    // Reset streaming content — replay will rebuild if needed.
    streamingParts = []
    replaySeq = 0
    error = null

    if (!hasExisting) {
      loading = true
      loaded = false
    }

    currentSessionId = sessionId

    try {
      const [messagesRes, stateRes] = await Promise.all([
        fetch(`${API_BASE}/sessions/${sessionId}/messages`),
        fetch(`${API_BASE}/sessions/${sessionId}/stream-state`),
      ])

      if (currentSessionId !== sessionId) return

      if (!messagesRes.ok)
        throw new Error(`${messagesRes.status} ${messagesRes.statusText}`)

      const serverMessages: MessageNode[] = await messagesRes.json()

      // During a background refresh, the server might not have caught
      // up yet (e.g. the run's Phase 1 hasn't persisted the user
      // message). Keep existing messages (including optimistic ones)
      // until the server has real data. MessagesAppended will trigger
      // another refresh when the server persists.
      if (hasExisting && serverMessages.length === 0) {
        // Server hasn't caught up — keep what we have
      } else {
        messages = serverMessages
      }

      // Replay stream state if the session is running
      if (stateRes.ok) {
        const state: StreamState = await stateRes.json()
        if (state.status === 'running') {
          replayEvents(state.events)
        }
      }

      // Stale stream-state check: the session store is the authority.
      // If RunEnd arrived during the fetch, discard the stale replay.
      if (!sessionStore.isRunning(sessionId)) {
        streamingParts = []
        replaySeq = 0
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
          replaySeq = 0
        }
      }
    } catch {
      if (opts?.clearParts && currentSessionId === sessionId) {
        streamingParts = []
        replaySeq = 0
      }
    }
  }

  /** Reset all state. Called when SessionView unmounts. */
  function clear() {
    messages = []
    currentSessionId = null
    loading = false
    loaded = false
    error = null
    streamingParts = []
    replaySeq = 0
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
