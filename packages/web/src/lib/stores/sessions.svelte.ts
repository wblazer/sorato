import { SessionsApi } from '$lib/connection-services.js'
import { runConnectionPromise } from '$lib/connection-runtime.js'
import type { UiApiError } from '$lib/api-errors.js'
import type {
  ActiveRunSummary,
  ModelOptions,
  RunAttachment,
  Session,
  SessionRunStatus,
} from '$lib/types.js'
import { Effect } from 'effect'
import { sseStore } from './sse.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { projectStore } from './projects.svelte.js'
import { onSessionRefreshRequest } from './session-refresh-bus.js'
import { tabStore } from './tabs.svelte.js'

export interface QueuedMessageDraft {
  id: string
  runId: string
  content: string
  attachments: ReadonlyArray<RunAttachment>
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
  // requested a stop and the run-scoped HTTP request is pending.

  let stoppingRuns = $state(new Set<string>())
  let queuedMessages = $state(new Map<string, QueuedMessageDraft[]>())
  let pendingRunStarts = $state(new Map<string, number>())
  let sessionStatuses = $state(new Map<string, SessionRunStatus>())
  let activeRuns = $state(new Map<string, ActiveRunSummary>())
  let latestRunStart = $state<{
    sessionId: string
    runId: string
    baseNodeId: string | null
    sequence: number
  } | null>(null)
  let runStartSequence = 0

  onSessionRefreshRequest((sessionId) => {
    void runConnectionPromise(refreshSession(sessionId))
  })

  function hydrateActiveRuns(nextSessions: ReadonlyArray<Session>) {
    const refreshedSessionIds = new Set(
      nextSessions.map((session) => session.id)
    )
    const next = new Map(
      [...activeRuns].filter(
        ([, run]) => !refreshedSessionIds.has(run.sessionId)
      )
    )

    for (const session of nextSessions) {
      for (const run of session.activeRuns ?? []) {
        if (run.visibility === 'background' && run.parentRunId !== undefined)
          continue
        next.set(run.runId, run)
      }
    }

    activeRuns = next
    messagesStore.hydrateBackgroundSummaries(
      nextSessions.flatMap((session) => session.activeRuns ?? [])
    )
  }

  sseStore.onEvent((event) => {
    if (event._tag === 'RunStart') {
      if (event.visibility === 'background' && event.parentRunId !== undefined)
        return

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
        visibility: event.visibility ?? 'primary',
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
    } else if (event._tag === 'RunBaseUpdated') {
      const existing = activeRuns.get(event.runId)
      if (existing) {
        const nextActiveRuns = new Map(activeRuns)
        nextActiveRuns.set(event.runId, {
          ...existing,
          baseNodeId: event.baseNodeId,
        })
        activeRuns = nextActiveRuns
      }

      if (latestRunStart?.runId === event.runId) {
        latestRunStart = {
          ...latestRunStart,
          baseNodeId: event.baseNodeId,
          sequence: ++runStartSequence,
        }
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

      if (stoppingRuns.has(event.runId)) {
        const next = new Set(stoppingRuns)
        next.delete(event.runId)
        stoppingRuns = next
      }
      void runConnectionPromise(refreshSession(event.sessionId))
    } else if (event._tag === 'SessionUpdated') {
      void runConnectionPromise(refreshSession(event.sessionId))
    }
  })

  /** Re-fetch a single session's metadata (background, silent). */
  function refreshSession(sessionId: string) {
    return Effect.gen(function* () {
      const sessionsApi = yield* SessionsApi
      const fresh = yield* sessionsApi.get(sessionId)

      yield* Effect.sync(() => {
        sessions = sessions.map((s) => (s.id === sessionId ? fresh : s))
        hydrateActiveRuns([fresh])
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
    const clearLoading = Effect.sync(() => {
      loading = false
    })

    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        loading = true
        error = null
      })

      const sessionsApi = yield* SessionsApi
      const result = yield* sessionsApi.list()

      yield* Effect.sync(() => {
        sessions = [...result]
        hydrateActiveRuns(result)
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
        })
      ),
      Effect.ensuring(clearLoading)
    )
  }

  /**
   * Create a new session in the selected project.
   * Returns the new session, or null on error.
   */
  function createSession(
    projectId?: string,
    tabId: string | null | undefined = tabStore.activeTab?.id
  ) {
    return Effect.gen(function* () {
      const resolvedProjectId =
        projectId ??
        tabStore.activeTab?.projectId ??
        projectStore.selectedProjectId
      const noSession = null
      if (!resolvedProjectId) return noSession

      const sessionsApi = yield* SessionsApi
      const session = yield* sessionsApi.create({
        projectId: resolvedProjectId,
      })

      return yield* Effect.sync(() => {
        sessions = [session, ...sessions]
        if (tabId) tabStore.attachSession(tabId, session)
        return session
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          const noSession = null
          error = cause.message
          return noSession
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
    attachments: ReadonlyArray<RunAttachment>,
    model: string,
    baseNodeId: string | null,
    afterRunId: string | null,
    modelOptions: ModelOptions = {}
  ) {
    return Effect.gen(function* () {
      const sessionsApi = yield* SessionsApi
      const data = yield* sessionsApi.run({
        sessionId,
        input,
        attachments,
        model,
        baseNodeId,
        afterRunId,
        modelOptions,
      })

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
              attachments,
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
          const noRun = null
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
          return noRun
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
      const sessionsApi = yield* SessionsApi
      const result = yield* sessionsApi.compactRange({
        sessionId,
        model,
        baseHeadNodeId,
        startNodeId,
        endNodeId,
        instructions,
      })

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
          const noRun = null
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
          return noRun
        })
      )
    )
  }

  /**
   * Stop an active agent run.
   *
   * `stopping` is local to the pending HTTP request. Run lifecycle truth comes
   * from SSE and persisted state refreshes.
   */
  function stopAgent(runId: string) {
    if (stoppingRuns.has(runId))
      return Effect.succeed({
        status: 'stopped' as const,
        focusNodeId: undefined as string | undefined,
      })

    stoppingRuns = new Set([...stoppingRuns, runId])
    const clearStopping = Effect.sync(() => {
      const next = new Set(stoppingRuns)
      next.delete(runId)
      stoppingRuns = next
    })

    return Effect.gen(function* () {
      const sessionsApi = yield* SessionsApi
      const data = yield* sessionsApi.stopRun(runId)

      return data
    }).pipe(
      Effect.ensuring(clearStopping),
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
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

  /** Check if a stop request for a run is pending. */
  function isStopping(runId: string | null): boolean {
    return runId !== null && stoppingRuns.has(runId)
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
      void runConnectionPromise(messagesStore.loadMessages(tab.id, id))
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
