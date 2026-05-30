import { httpErrorMessage, requestErrorMessage } from '$lib/api-errors.js'
import type { ModelOptions, Session } from '$lib/types.js'
import { sseStore } from './sse.svelte.js'
import { connectionsStore } from './connections.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { modelsStore } from './models.svelte.js'
import { projectStore } from './projects.svelte.js'
import { onSessionRefreshRequest } from './session-refresh-bus.js'
import { tabStore } from './tabs.svelte.js'

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
  let composing = $state(true)

  const filteredSessions = $derived.by(() => {
    const projectId =
      tabStore.activeTab?.projectId ?? projectStore.selectedProjectId
    return sessions
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

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
  let sessionErrors = $state(new Map<string, string>())

  onSessionRefreshRequest((sessionId) => {
    void refreshSession(sessionId)
  })

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

      if (sessionErrors.has(event.sessionId)) {
        const next = new Map(sessionErrors)
        next.delete(event.sessionId)
        sessionErrors = next
      }
    } else if (event._tag === 'RunFailed') {
      const next = new Map(sessionErrors)
      next.set(event.sessionId, event.message)
      sessionErrors = next
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
      tabStore.updateSessionTitle(fresh.id, fresh.title)

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
      if (!res.ok) throw new Error(await httpErrorMessage(res))
      sessions = await res.json()

      const projectId =
        tabStore.activeTab?.projectId ?? projectStore.selectedProjectId
      if (projectId) void modelsStore.load(projectId)
    } catch (e) {
      error = requestErrorMessage(e, 'Failed to load sessions')
    } finally {
      loading = false
    }
  }

  /**
   * Create a new session in the selected project.
   * Returns the new session, or null on error.
   */
  async function createSession(projectId?: string): Promise<Session | null> {
    const resolvedProjectId =
      projectId ??
      tabStore.activeTab?.projectId ??
      projectStore.selectedProjectId
    if (!resolvedProjectId) return null

    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: resolvedProjectId }),
      })
      if (!res.ok) throw new Error(await httpErrorMessage(res))

      const session: Session = await res.json()
      sessions = [session, ...sessions]
      selectedSessionId = session.id
      composing = false
      if (tabStore.activeTab)
        tabStore.attachSession(tabStore.activeTab.id, session)
      return session
    } catch (e) {
      error = requestErrorMessage(e, 'Failed to create session')
      return null
    }
  }

  /**
   * Start an agent run on a session.
   * Fire-and-forget — events stream via SSE.
   */
  async function runAgent(
    sessionId: string,
    input: string,
    model: string,
    modelOptions: ModelOptions = {}
  ): Promise<boolean> {
    try {
      const res = await fetch(
        `${connectionsStore.getApiBase()}/sessions/${sessionId}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, model, modelOptions }),
        }
      )
      if (!res.ok) throw new Error(await httpErrorMessage(res))

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
      const message = requestErrorMessage(e, 'Failed to start agent run')
      error = message
      const next = new Map(sessionErrors)
      next.set(sessionId, message)
      sessionErrors = next
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
      if (!res.ok) throw new Error(await httpErrorMessage(res))
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
      error = requestErrorMessage(e, 'Failed to stop agent run')
      return 'error'
    }
  }

  /** Enter new-session composer mode. */
  function startComposing() {
    selectedSessionId = null
    composing = true
    messagesStore.clear()
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

  function sessionError(sessionId: string): string | null {
    return sessionErrors.get(sessionId) ?? null
  }

  function displayTitle(session: Session): string {
    if (session.title) return session.title
    return `New Session - ${session.id}`
  }

  function clearSessionError(sessionId: string) {
    if (!sessionErrors.has(sessionId)) return
    const next = new Map(sessionErrors)
    next.delete(sessionId)
    sessionErrors = next
  }

  return {
    get sessions() {
      return sessions
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
    selectProject(projectId: string) {
      projectStore.selectProject(projectId)
      if (tabStore.activeTab)
        tabStore.setDraftProject(tabStore.activeTab.id, projectId)
      selectedSessionId = null
      composing = true
      messagesStore.clear()
      void modelsStore.load(projectId)
    },
    selectSession(id: string) {
      selectedSessionId = id
      composing = false
      const session = sessions.find((item) => item.id === id)
      if (session && tabStore.activeTab)
        tabStore.attachSession(tabStore.activeTab.id, session)
      void messagesStore.loadMessages(id)
    },
    isRunning,
    isStopping,
    sessionError,
    displayTitle,
    clearSessionError,
    queuedMessagesFor,
    startComposing,
    createSession,
    runAgent,
    stopAgent,
    fetchSessions,
  }
}

export const sessionStore = createSessionStore()
