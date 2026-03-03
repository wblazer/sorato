/**
 * Messages store — fetches and streams messages for the active session.
 *
 * Receives events from the global SSE store (no per-session connections).
 * Filters events by `currentSessionId` — navigating between sessions is
 * just a filter change, no SSE teardown/reconnect.
 *
 * When joining a running session (page load, navigation), the store
 * fetches the replay buffer from `/stream-state` and replays it to
 * reconstruct the current streaming state. A `seq` dedup mechanism
 * prevents double-counting events that arrive via both replay and live SSE.
 */
import type {
  MessageNode,
  MessagePart,
  ServerEvent,
  StreamState,
} from '$lib/types.js'
import { sseStore } from './sse.svelte.js'

const API_BASE = 'http://localhost:3100'

function createMessagesStore() {
  let messages = $state<MessageNode[]>([])
  let loading = $state(false)
  let loaded = $state(false)
  let error = $state<string | null>(null)
  let currentSessionId = $state<string | null>(null)

  // Streaming state: an ordered list of parts as they arrive.
  let streamingParts = $state<MessagePart[]>([])
  let isStreaming = $state(false)

  // Dedup: highest seq from the replay buffer. Live events with
  // seq <= this value were already replayed and should be skipped.
  let replaySeq = 0

  // ── Global SSE subscription ─────────────────────────────────────
  //
  // Registered at module init. The handler checks currentSessionId
  // on every event — before loadMessages sets it, events are ignored.
  // After loadMessages, events flow through and are deduped against
  // any replay buffer that was already applied.

  sseStore.onEvent((event) => {
    if (!('sessionId' in event) || event.sessionId !== currentSessionId) return

    // Dedup content events already covered by replay
    if ('seq' in event && event.seq <= replaySeq) return

    switch (event._tag) {
      case 'RunStart':
        isStreaming = true
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
        // Don't clear streaming state yet — keep it visible until
        // the refresh lands to avoid the flash.
        if (currentSessionId) {
          refreshMessages(currentSessionId, { clearStreaming: true })
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
      // Svelte 5 reactivity needs a new array reference.
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
   * Load messages and stream state for a session.
   *
   * If the session is mid-run, the replay buffer is applied to
   * reconstruct streaming state. Live SSE events arriving after
   * this call are deduped against the replay via `seq`.
   */
  async function loadMessages(sessionId: string) {
    // Show loading indicator only if we have no messages to display
    // (avoids flash when navigating back to a session we've seen before
    // or when an optimistic message is already visible).
    const hasExisting = currentSessionId === sessionId && messages.length > 0

    // Reset streaming state — replay will rebuild if the session is running
    streamingParts = []
    isStreaming = false
    replaySeq = 0
    error = null

    if (!hasExisting) {
      loading = true
      loaded = false
    }

    // Set currentSessionId AFTER resetting streaming state but BEFORE
    // the async fetch. This is safe: JavaScript is single-threaded, so
    // no SSE handler can fire between the reset above and this assignment.
    // Any SSE events that arrive during the fetch will be processed
    // normally (and deduped against the replay when it lands).
    //
    // HOWEVER: events that arrived before we set currentSessionId are
    // gone — they were filtered out by our SSE handler. The replay
    // buffer covers them.
    currentSessionId = sessionId

    try {
      // Fetch messages and stream state in parallel
      const [messagesRes, stateRes] = await Promise.all([
        fetch(`${API_BASE}/sessions/${sessionId}/messages`),
        fetch(`${API_BASE}/sessions/${sessionId}/stream-state`),
      ])

      // Bail if the user navigated away during the fetch
      if (currentSessionId !== sessionId) return

      if (!messagesRes.ok)
        throw new Error(`${messagesRes.status} ${messagesRes.statusText}`)
      messages = await messagesRes.json()

      // Replay stream state if the session is running
      if (stateRes.ok) {
        const state: StreamState = await stateRes.json()
        if (state.status === 'running') {
          isStreaming = true
          replayEvents(state.events)
        }
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
   * Re-fetch messages without changing loading state (background refresh).
   * When `clearStreaming` is true, streaming state is cleared after the
   * fetch resolves — prevents the flash on RunEnd.
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
          replaySeq = 0
        }
      }
    } catch {
      // Silent failure — still clear streaming to avoid stuck indicator
      if (opts?.clearStreaming && currentSessionId === sessionId) {
        isStreaming = false
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
    isStreaming = false
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
    get isStreaming() {
      return isStreaming
    },
    loadMessages,
    addOptimisticUserMessage,
    clear,
  }
}

export const messagesStore = createMessagesStore()
