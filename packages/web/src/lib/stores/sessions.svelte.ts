import type { Session } from '$lib/types.js'
import { sseStore } from './sse.svelte.js'

const API_BASE = 'http://localhost:3100'

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

  // ── Running state from SSE ────────────────────────────────────────
  //
  // Track which sessions are currently running, updated in real-time
  // from the global SSE stream. Initial state comes from the `status`
  // field on sessions fetched from the server.

  sseStore.onEvent((event) => {
    if (event._tag === 'RunStart') {
      // Update the session's status in the local list
      sessions = sessions.map((s) =>
        s.id === event.sessionId ? { ...s, status: 'running' as const } : s
      )
    } else if (event._tag === 'RunEnd') {
      sessions = sessions.map((s) =>
        s.id === event.sessionId ? { ...s, status: 'idle' as const } : s
      )
    } else if (event._tag === 'SessionUpdated') {
      // Session metadata changed — re-fetch to pick up title changes etc.
      refreshSession(event.sessionId)
    }
  })

  /** Re-fetch a single session's metadata (background, silent). */
  async function refreshSession(sessionId: string) {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}`)
      if (!res.ok) return
      const fresh: Session = await res.json()
      sessions = sessions.map((s) => (s.id === sessionId ? fresh : s))
    } catch {
      // Silent
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  async function fetchSessions() {
    loading = true
    error = null
    try {
      const res = await fetch(`${API_BASE}/sessions`)
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
      const res = await fetch(`${API_BASE}/sessions`, {
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
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return true
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to start agent run'
      return false
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
    startComposing,
    createSession,
    runAgent,
    fetchSessions,
  }
}

export const sessionStore = createSessionStore()
