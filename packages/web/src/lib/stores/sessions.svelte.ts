import type { Session } from '$lib/types.js'
import { sseStore } from './sse.svelte.js'
import { connectionsStore } from './connections.svelte.js'

export interface QueuedMessageDraft {
  id: string
  content: string
  createdAt: number
}

function createSessionStore() {
  let sessions = $state<Session[]>([])
  let selectedSessionId = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  /**
   * When true, the main area shows the new-session composer
   * instead of an existing session view.
   */
  let composing = $state(false)

  // Directories the user has explicitly opened (may not have sessions yet)
  let openedDirectories = $state<string[]>([])

  // Merge session-derived directories with explicitly opened ones
  const directories = $derived(
    [
      ...new Set([...openedDirectories, ...sessions.map((s) => s.directory)]),
    ].sort()
  )

  let selectedDirectory = $state('')

  const filteredSessions = $derived(
    sessions
      .filter((s) => s.directory === selectedDirectory)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  )

  // ── Running / stopping state from SSE ───────────────────────────────
  //
  // Track which sessions are currently running, updated in real-time
  // from the global SSE stream. Initial state comes from the `status`
  // field on sessions fetched from the server.
  //
  // `stopping` is a frontend-only transitional state: the user has
  // requested a stop but the server hasn't confirmed it yet (RunEnd
  // hasn't arrived). Used for immediate visual feedback and to block
  // duplicate stop requests.

  let stoppingSessions = $state(new Set<string>())
  let queuedMessages = $state(new Map<string, QueuedMessageDraft[]>())
  let pendingRunStarts = $state(new Map<string, number>())

  sseStore.onEvent((event) => {
    if (event._tag === 'RunStart') {
      const pendingStarts = pendingRunStarts.get(event.sessionId) ?? 0
      if (pendingStarts > 0) {
        const next = new Map(pendingRunStarts)
        if (pendingStarts === 1) {
          next.delete(event.sessionId)
        } else {
          next.set(event.sessionId, pendingStarts - 1)
        }
        pendingRunStarts = next
      } else {
        const drafts = queuedMessages.get(event.sessionId) ?? []
        if (drafts.length > 0) {
          const next = new Map(queuedMessages)
          if (drafts.length === 1) {
            next.delete(event.sessionId)
          } else {
            next.set(event.sessionId, drafts.slice(1))
          }
          queuedMessages = next
        }
      }

      sessions = sessions.map((s) =>
        s.id === event.sessionId ? { ...s, status: 'running' as const } : s
      )
    } else if (event._tag === 'RunEnd') {
      // Clear stopping state — the run is definitively done.
      if (stoppingSessions.has(event.sessionId)) {
        const next = new Set(stoppingSessions)
        next.delete(event.sessionId)
        stoppingSessions = next
      }
      void refreshSession(event.sessionId)
    } else if (event._tag === 'SessionUpdated') {
      refreshSession(event.sessionId)
    }
  })

  /** Re-fetch a single session's metadata (background, silent). */
  async function refreshSession(sessionId: string) {
    try {
      const res = await fetch(
        `${connectionsStore.getApiBase()}/sessions/${sessionId}`
      )
      if (!res.ok) return
      const fresh: Session = await res.json()
      sessions = sessions.map((s) => (s.id === sessionId ? fresh : s))

      if (fresh.status === 'idle') {
        const nextQueued = new Map(queuedMessages)
        nextQueued.delete(sessionId)
        queuedMessages = nextQueued

        const nextPending = new Map(pendingRunStarts)
        nextPending.delete(sessionId)
        pendingRunStarts = nextPending
      }
    } catch {
      // Silent
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  async function fetchSessions() {
    loading = true
    error = null
    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/sessions`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      sessions = await res.json()

      // Auto-select first directory if none selected
      if (!selectedDirectory && directories.length > 0) {
        selectedDirectory = directories[0] ?? ''
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to fetch sessions'
    } finally {
      loading = false
    }
  }

  /**
   * Create a new session in the currently selected directory.
   * Returns the new session, or null on error.
   */
  async function createSession(directory?: string): Promise<Session | null> {
    const dir = directory ?? selectedDirectory
    if (!dir) return null

    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: dir }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const session: Session = await res.json()
      sessions = [session, ...sessions]
      selectedSessionId = session.id
      composing = false
      return session
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create session'
      return null
    }
  }

  /**
   * Start an agent run on a session.
   * Fire-and-forget — events stream via SSE.
   */
  async function runAgent(sessionId: string, input: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${connectionsStore.getApiBase()}/sessions/${sessionId}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        }
      )
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const data: { status: 'started' | 'queued' } = await res.json()

      sessions = sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'running' as const } : s
      )

      if (data.status === 'started') {
        const next = new Map(pendingRunStarts)
        next.set(sessionId, (next.get(sessionId) ?? 0) + 1)
        pendingRunStarts = next
      } else {
        const next = new Map(queuedMessages)
        next.set(sessionId, [
          ...(next.get(sessionId) ?? []),
          {
            id: crypto.randomUUID(),
            content: input,
            createdAt: Date.now(),
          },
        ])
        queuedMessages = next
      }

      return true
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to start agent run'
      return false
    }
  }

  /**
   * Stop an active agent run on a session.
   *
   * Transitions to 'stopping' immediately for visual feedback, then
   * fires the server request. The 'stopping' state is cleared when
   * RunEnd arrives via SSE, not when the HTTP response returns —
   * this ensures the UI stays in "stopping" until the run is truly done.
   */
  async function stopAgent(
    sessionId: string
  ): Promise<'stopped' | 'not_running' | 'error'> {
    // Guard: don't send duplicate stop requests.
    if (stoppingSessions.has(sessionId)) return 'stopped'

    // Optimistic: mark as stopping immediately for UI feedback.
    stoppingSessions = new Set([...stoppingSessions, sessionId])

    try {
      const res = await fetch(
        `${connectionsStore.getApiBase()}/sessions/${sessionId}/stop`,
        {
          method: 'POST',
        }
      )
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data: { status: 'stopped' | 'not_running' } = await res.json()
      // If the server says it wasn't running, clear stopping state
      // immediately (no RunEnd will arrive).
      if (data.status === 'not_running') {
        const next = new Set(stoppingSessions)
        next.delete(sessionId)
        stoppingSessions = next
      }
      return data.status
    } catch (e) {
      // On error, clear stopping state so the user can retry.
      const next = new Set(stoppingSessions)
      next.delete(sessionId)
      stoppingSessions = next
      error = e instanceof Error ? e.message : 'Failed to stop agent run'
      return 'error'
    }
  }

  /** Enter new-session composer mode. */
  function startComposing() {
    selectedSessionId = null
    composing = true
  }

  /** Check if a session currently has an active run. */
  function isRunning(sessionId: string): boolean {
    const session = sessions.find((s) => s.id === sessionId)
    return session?.status === 'running'
  }

  /** Check if a stop has been requested but hasn't completed yet. */
  function isStopping(sessionId: string): boolean {
    return stoppingSessions.has(sessionId)
  }

  function queuedMessagesFor(sessionId: string): QueuedMessageDraft[] {
    return queuedMessages.get(sessionId) ?? []
  }

  return {
    get sessions() {
      return sessions
    },
    get directories() {
      return directories
    },
    get selectedDirectory() {
      return selectedDirectory
    },
    get filteredSessions() {
      return filteredSessions
    },
    get selectedSessionId() {
      return selectedSessionId
    },
    get composing() {
      return composing
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    selectDirectory(dir: string) {
      selectedDirectory = dir
      selectedSessionId = null
      composing = false
    },
    /** Open a directory — adds it to the known list and selects it */
    openDirectory(dir: string) {
      if (!openedDirectories.includes(dir)) {
        openedDirectories = [...openedDirectories, dir]
      }
      selectedDirectory = dir
      selectedSessionId = null
      composing = false
    },
    selectSession(id: string) {
      selectedSessionId = id
      composing = false
    },
    isRunning,
    isStopping,
    queuedMessagesFor,
    startComposing,
    createSession,
    runAgent,
    stopAgent,
    fetchSessions,
  }
}

export const sessionStore = createSessionStore()
