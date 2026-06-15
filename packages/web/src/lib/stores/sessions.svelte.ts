import { getApiClient, runApi } from '$lib/api-client.js'
import { requestErrorMessage } from '$lib/api-errors.js'
import type { ModelOptions, Session, SessionRunStatus } from '$lib/types.js'
import { sseStore } from './sse.svelte.js'
import { connectionsStore } from './connections.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { modelsStore } from './models.svelte.js'
import { projectStore } from './projects.svelte.js'
import { onSessionRefreshRequest } from './session-refresh-bus.js'
import { tabStore } from './tabs.svelte.js'

export interface QueuedMessageDraft {
  id: string
  runId: string
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
  let sessionStatuses = $state(new Map<string, SessionRunStatus>())
  let activeRuns = $state(
    new Map<
      string,
      { sessionId: string; runId: string; baseNodeId: string | null }
    >()
  )
  let latestRunStart = $state<{
    sessionId: string
    runId: string
    baseNodeId: string | null
    sequence: number
  } | null>(null)
  let runStartSequence = 0

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
      }

      const drafts = queuedMessages.get(event.sessionId) ?? []
      if (drafts.length > 0) {
        const remaining = drafts.filter((draft) => draft.runId !== event.runId)
        const next = new Map(queuedMessages)
        if (remaining.length === 0) {
          next.delete(event.sessionId)
        } else {
          next.set(event.sessionId, remaining)
        }
        queuedMessages = next
      }

      const nextActiveRuns = new Map(activeRuns)
      nextActiveRuns.set(event.runId, {
        sessionId: event.sessionId,
        runId: event.runId,
        baseNodeId: event.baseNodeId,
      })
      activeRuns = nextActiveRuns
      latestRunStart = {
        sessionId: event.sessionId,
        runId: event.runId,
        baseNodeId: event.baseNodeId,
        sequence: ++runStartSequence,
      }

      sessions = sessions.map((s) =>
        s.id === event.sessionId ? { ...s, status: 'running' as const } : s
      )

      if (sessionStatuses.has(event.sessionId)) {
        const next = new Map(sessionStatuses)
        next.delete(event.sessionId)
        sessionStatuses = next
      }
    } else if (event._tag === 'RunRetrying') {
      const next = new Map(sessionStatuses)
      next.set(event.sessionId, {
        _tag: 'retrying',
        title: event.title,
        message: event.message,
        retryAt: event.retryAt,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
      })
      sessionStatuses = next
    } else if (event._tag === 'RunFailed') {
      const next = new Map(sessionStatuses)
      next.set(event.sessionId, {
        _tag: 'failed',
        title: event.title ?? 'Run failed',
        message: event.message,
        detail: event.detail,
        retryable: event.retryable ?? false,
      })
      sessionStatuses = next
    } else if (event._tag === 'RunEnd') {
      const existingStatus = sessionStatuses.get(event.sessionId)
      if (existingStatus?._tag === 'retrying') {
        const next = new Map(sessionStatuses)
        next.delete(event.sessionId)
        sessionStatuses = next
      }

      const nextActiveRuns = new Map(activeRuns)
      nextActiveRuns.delete(event.runId)
      activeRuns = nextActiveRuns

      if (
        !activeRunsFor(event.sessionId).length &&
        stoppingSessions.has(event.sessionId)
      ) {
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
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.get({ params: { id: sessionId } }),
        'Failed to refresh session'
      )
      if (!result.ok) return
      const fresh: Session = result.value
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
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.list(),
        'Failed to load sessions'
      )
      if (!result.ok) {
        error = result.error.message
        return
      }
      sessions = [...result.value]

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
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.create({ payload: { projectId: resolvedProjectId } }),
        'Failed to create session'
      )
      if (!result.ok) {
        error = result.error.message
        return null
      }

      const session: Session = result.value
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
    baseNodeId: string | null,
    afterRunId: string | null,
    modelOptions: ModelOptions = {}
  ): Promise<{
    status: 'started' | 'queued'
    runId: string
    baseNodeId: string | null
  } | null> {
    try {
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.run({
          params: { id: sessionId },
          payload: {
            input,
            model,
            baseNodeId,
            afterRunId,
            modelOptions,
          },
        }),
        'Failed to start agent run'
      )
      if (!result.ok) {
        const message = result.error.message
        error = message
        const next = new Map(sessionStatuses)
        next.set(sessionId, {
          _tag: 'failed',
          title: 'Run failed to start',
          message,
          retryable: result.error.retryable,
        })
        sessionStatuses = next
        return null
      }

      const data = result.value

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
            runId: data.runId,
            content: input,
            createdAt: Date.now(),
          },
        ])
        queuedMessages = next
      }

      return data
    } catch (e) {
      const message = requestErrorMessage(e, 'Failed to start agent run')
      error = message
      const next = new Map(sessionStatuses)
      next.set(sessionId, {
        _tag: 'failed',
        title: 'Run failed to start',
        message,
        retryable: false,
      })
      sessionStatuses = next
      return null
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
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.stop({ params: { id: sessionId } }),
        'Failed to stop agent run'
      )
      if (!result.ok) throw new Error(result.error.message)
      const data = result.value
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

  function isRunActive(runId: string): boolean {
    return activeRuns.has(runId)
  }

  function activeRunsFor(sessionId: string) {
    return [...activeRuns.values()].filter((run) => run.sessionId === sessionId)
  }

  /** Check if a stop has been requested but hasn't completed yet. */
  function isStopping(sessionId: string): boolean {
    return stoppingSessions.has(sessionId)
  }

  function queuedMessagesFor(sessionId: string): QueuedMessageDraft[] {
    return queuedMessages.get(sessionId) ?? []
  }

  function sessionStatus(sessionId: string): SessionRunStatus | null {
    return sessionStatuses.get(sessionId) ?? null
  }

  function displayTitle(session: Session): string {
    if (session.title) return session.title
    return `New Session - ${session.id}`
  }

  function clearSessionError(sessionId: string) {
    if (!sessionStatuses.has(sessionId)) return
    const next = new Map(sessionStatuses)
    next.delete(sessionId)
    sessionStatuses = next
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
    isRunActive,
    activeRunsFor,
    get latestRunStart() {
      return latestRunStart
    },
    isStopping,
    sessionStatus,
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
