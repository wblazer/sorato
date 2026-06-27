import { apiClient, runApiEffect } from '$lib/api-client.js'
import type { UiApiError } from '$lib/api-errors.js'
import type { ModelOptions, Session, SessionRunStatus } from '$lib/types.js'
import { Effect } from 'effect'
import { sseStore } from './sse.svelte.js'
import { connectionsStore } from './connections.svelte.js'
import { messagesStore } from './messages.svelte.js'
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
  let loading = $state(false)
  let error = $state<string | null>(null)

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
      {
        sessionId: string
        runId: string
        baseNodeId: string | null
        kind: 'agent' | 'summary'
      }
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
    void Effect.runPromise(refreshSession(sessionId))
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
        kind: event.kind ?? 'agent',
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
  function refreshSession(sessionId: string) {
    return Effect.gen(function* () {
      const client = yield* apiClient(connectionsStore.getApiBase())
      const fresh = yield* runApiEffect(
        client.sessions.get({ params: { id: sessionId } }),
        'Failed to refresh session'
      )

      yield* Effect.sync(() => {
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
      })
    }).pipe(Effect.catch(() => Effect.void))
  }

  // ── Public API ────────────────────────────────────────────────────

  function fetchSessions() {
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        loading = true
        error = null
      })

      const client = yield* apiClient(connectionsStore.getApiBase())
      const result = yield* runApiEffect(
        client.sessions.list(),
        'Failed to load sessions'
      )

      yield* Effect.sync(() => {
        sessions = [...result]
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          loading = false
        })
      )
    )
  }

  /**
   * Create a new session in the selected project.
   * Returns the new session, or null on error.
   */
  function createSession(projectId?: string, tabId = tabStore.activeTab?.id) {
    return Effect.gen(function* () {
      const resolvedProjectId =
        projectId ??
        tabStore.activeTab?.projectId ??
        projectStore.selectedProjectId
      if (!resolvedProjectId) return null

      const client = yield* apiClient(connectionsStore.getApiBase())
      const session = yield* runApiEffect(
        client.sessions.create({ payload: { projectId: resolvedProjectId } }),
        'Failed to create session'
      )

      return yield* Effect.sync(() => {
        sessions = [session, ...sessions]
        if (tabId) tabStore.attachSession(tabId, session)
        return session
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
          return null
        })
      )
    )
  }

  /**
   * Start an agent run on a session.
   * Fire-and-forget — events stream via SSE.
   */
  function runAgent(
    sessionId: string,
    input: string,
    model: string,
    baseNodeId: string | null,
    afterRunId: string | null,
    modelOptions: ModelOptions = {}
  ) {
    return Effect.gen(function* () {
      const client = yield* apiClient(connectionsStore.getApiBase())
      const data = yield* runApiEffect(
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

      return yield* Effect.sync(() => {
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
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          const message = cause.message
          error = message
          const next = new Map(sessionStatuses)
          next.set(sessionId, {
            _tag: 'failed',
            title: 'Run failed to start',
            message,
            retryable: cause.retryable,
          })
          sessionStatuses = next
          return null
        })
      )
    )
  }

  function compactRange(
    sessionId: string,
    model: string,
    baseHeadNodeId: string,
    startNodeId: string,
    endNodeId: string,
    instructions?: string
  ) {
    return Effect.gen(function* () {
      const client = yield* apiClient(connectionsStore.getApiBase())
      const result = yield* runApiEffect(
        client.sessions.compactRange({
          params: { id: sessionId },
          payload: {
            model,
            baseHeadNodeId,
            startNodeId,
            endNodeId,
            instructions,
          },
        }),
        'Failed to start summarization'
      )

      return yield* Effect.sync(() => {
        sessions = sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'running' as const } : s
        )
        if (result.status === 'started') {
          const next = new Map(pendingRunStarts)
          next.set(sessionId, (next.get(sessionId) ?? 0) + 1)
          pendingRunStarts = next
        }
        return result
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          const message = cause.message
          error = message
          const next = new Map(sessionStatuses)
          next.set(sessionId, {
            _tag: 'failed',
            title: 'Summarization failed to start',
            message,
            retryable: cause.retryable,
          })
          sessionStatuses = next
          return null
        })
      )
    )
  }

  /**
   * Stop an active agent run on a session.
   *
   * Transitions to 'stopping' immediately for visual feedback, then
   * fires the server request. The 'stopping' state is cleared when
   * RunEnd arrives via SSE, not when the HTTP response returns —
   * this ensures the UI stays in "stopping" until the run is truly done.
   */
  function stopAgent(sessionId: string) {
    // Guard: don't send duplicate stop requests.
    if (stoppingSessions.has(sessionId))
      return Effect.succeed('stopped' as const)

    // Optimistic: mark as stopping immediately for UI feedback.
    stoppingSessions = new Set([...stoppingSessions, sessionId])

    return Effect.gen(function* () {
      const client = yield* apiClient(connectionsStore.getApiBase())
      const data = yield* runApiEffect(
        client.sessions.stop({ params: { id: sessionId } }),
        'Failed to stop agent run'
      )

      return yield* Effect.sync(() => {
        // If the server says it wasn't running, clear stopping state
        // immediately (no RunEnd will arrive).
        if (data.status === 'not_running') {
          const next = new Set(stoppingSessions)
          next.delete(sessionId)
          stoppingSessions = next
        }
        return data.status
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          // On error, clear stopping state so the user can retry.
          const next = new Set(stoppingSessions)
          next.delete(sessionId)
          stoppingSessions = next
          error = cause.message
          return 'error' as const
        })
      )
    )
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

  function activeRun(runId: string | null) {
    return runId === null ? null : (activeRuns.get(runId) ?? null)
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
    },
    selectSession(id: string) {
      const session = sessions.find((item) => item.id === id)
      const tab = tabStore.activeTab
      if (!session || !tab) return

      tabStore.attachSession(tab.id, session)
      void Effect.runPromise(messagesStore.loadMessages(tab.id, id))
    },
    isRunning,
    isRunActive,
    activeRunsFor,
    activeRun,
    get latestRunStart() {
      return latestRunStart
    },
    isStopping,
    sessionStatus,
    displayTitle,
    clearSessionError,
    queuedMessagesFor,
    createSession,
    runAgent,
    compactRange,
    stopAgent,
    fetchSessions,
  }
}

export const sessionStore = createSessionStore()
