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
import { Effect, Schema } from 'effect'
import { patchSessionFromNodeBatch } from '$lib/session-events.js'
import {
  activeRunFromUpserted,
  removeActiveRun,
  sessionHasRunWork,
  upsertActiveRun,
} from '$lib/active-run-events.js'
import { sseStore } from './sse.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { projectStore } from './projects.svelte.js'
import { onSessionRefreshRequest } from './session-refresh-bus.js'
import { connectionsStore } from './connections.svelte.js'
import {
  getJsonWithSchema,
  setJsonWithSchema,
  storageKey,
} from '$lib/storage.js'

export interface QueuedMessageDraft {
  id: string
  runId: string
  content: string
  attachments: ReadonlyArray<RunAttachment>
  createdAt: number
}

const SelectedSessionSchema = Schema.NullOr(Schema.String)
const SettledSessionIdsSchema = Schema.Array(Schema.String)

const selectedSessionKey = (connectionId: string) =>
  storageKey('connection', connectionId, 'selected-session')

const settledSessionIdsKey = (connectionId: string) =>
  storageKey('connection', connectionId, 'settled-sessions')

function createSessionStore() {
  let sessions = $state<Session[]>([])
  let navigationConnectionId = $state<string | null>(null)
  let selectedSessionId = $state<string | null>(null)
  let settledSessionIds = $state(new Set<string>())
  let loading = $state(false)
  let error = $state<string | null>(null)

  function persistSelectedSession() {
    const connectionId = connectionsStore.activeConnectionScopeId
    if (!connectionId) return
    setJsonWithSchema(
      selectedSessionKey(connectionId),
      SelectedSessionSchema,
      selectedSessionId
    )
  }

  function persistSettledSessions() {
    const connectionId = connectionsStore.activeConnectionScopeId
    if (!connectionId) return
    setJsonWithSchema(
      settledSessionIdsKey(connectionId),
      SettledSessionIdsSchema,
      [...settledSessionIds]
    )
  }

  function reconcileNavigation(nextSessions: ReadonlyArray<Session>) {
    const connectionId = connectionsStore.activeConnectionScopeId
    if (!connectionId) return

    if (navigationConnectionId !== connectionId) {
      navigationConnectionId = connectionId
      selectedSessionId = getJsonWithSchema(
        selectedSessionKey(connectionId),
        SelectedSessionSchema,
        null
      )
      settledSessionIds = new Set(
        getJsonWithSchema(
          settledSessionIdsKey(connectionId),
          SettledSessionIdsSchema,
          []
        )
      )
    }

    const knownSessionIds = new Set(nextSessions.map((session) => session.id))
    if (selectedSessionId && !knownSessionIds.has(selectedSessionId)) {
      selectedSessionId = null
      persistSelectedSession()
    }

    const reconciledSettledIds = new Set(
      [...settledSessionIds].filter((id) => knownSessionIds.has(id))
    )
    if (reconciledSettledIds.size !== settledSessionIds.size) {
      settledSessionIds = reconciledSettledIds
      persistSettledSessions()
    }
  }

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
  let latestRunStart = $state<
    (ActiveRunSummary & { readonly sequence: number }) | null
  >(null)
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
        next.set(run.runId, run)
      }
    }

    activeRuns = next
    messagesStore.hydrateBackgroundChildRuns(
      nextSessions.flatMap((session) => session.activeRuns ?? [])
    )
  }

  sseStore.onEvent((event) => {
    if (event._tag === 'ActiveRunUpserted') {
      const run = activeRunFromUpserted(event)
      const next = upsertActiveRun(
        { activeRuns, pendingRunStarts, queuedMessages },
        run
      )
      activeRuns = next.activeRuns
      pendingRunStarts = next.pendingRunStarts
      queuedMessages = next.queuedMessages
      latestRunStart = {
        ...run,
        sequence: ++runStartSequence,
      }

      sessions = sessions.map((s) =>
        s.id === run.sessionId ? { ...s, status: 'running' as const } : s
      )

      if (sessionStatuses.has(run.sessionId)) {
        const nextStatuses = new Map(sessionStatuses)
        nextStatuses.delete(run.sessionId)
        sessionStatuses = nextStatuses
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
    } else if (event._tag === 'NodeBatchCommitted') {
      sessions = sessions.map((session) =>
        patchSessionFromNodeBatch(session, event)
      )
    } else if (event._tag === 'RunEnd') {
      const existingStatus = sessionStatuses.get(event.sessionId)
      if (existingStatus?._tag === 'retrying') {
        const next = new Map(sessionStatuses)
        next.delete(event.sessionId)
        sessionStatuses = next
      }

      const nextActiveRuns = removeActiveRun(activeRuns, event.runId)
      activeRuns = nextActiveRuns

      const remainsRunning = sessionHasRunWork(
        {
          activeRuns: nextActiveRuns,
          pendingRunStarts,
          queuedMessages,
        },
        event.sessionId
      )
      const status: Session['status'] = remainsRunning ? 'running' : 'idle'
      sessions = sessions.map((session) =>
        session.id === event.sessionId
          ? {
              ...session,
              status,
            }
          : session
      )

      if (stoppingRuns.has(event.runId)) {
        const next = new Set(stoppingRuns)
        next.delete(event.runId)
        stoppingRuns = next
      }
      if (latestRunStart?.runId === event.runId) latestRunStart = null
    } else if (event._tag === 'SessionTitleUpdated') {
      sessions = sessions.map((session) =>
        session.id === event.sessionId
          ? {
              ...session,
              title: event.title,
              updatedAt: event.updatedAt,
            }
          : session
      )
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
        reconcileNavigation(result)
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
  function createSession(projectId?: string) {
    return Effect.gen(function* () {
      const resolvedProjectId = projectId ?? projectStore.selectedProjectId
      const noSession = null
      if (!resolvedProjectId) return noSession

      const sessionsApi = yield* SessionsApi
      const session = yield* sessionsApi.create({
        projectId: resolvedProjectId,
      })

      return yield* Effect.sync(() => {
        sessions = [session, ...sessions]
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

  function selectSession(
    id: string,
    options: { readonly loadMessages?: boolean } = {}
  ) {
    const session = sessions.find((item) => item.id === id)
    if (!session) return

    selectedSessionId = id
    persistSelectedSession()
    projectStore.selectProject(session.projectId)
    if (options.loadMessages !== false) {
      void runConnectionPromise(messagesStore.loadMessages(id))
    }
  }

  function startNewSession(projectId?: string) {
    selectedSessionId = null
    persistSelectedSession()
    messagesStore.clearSession()
    if (projectId) projectStore.selectProject(projectId)
  }

  function settleSession(id: string) {
    if (settledSessionIds.has(id)) return
    settledSessionIds = new Set([...settledSessionIds, id])
    persistSettledSessions()
  }

  function unsettleSession(id: string) {
    if (!settledSessionIds.has(id)) return
    const next = new Set(settledSessionIds)
    next.delete(id)
    settledSessionIds = next
    persistSettledSessions()
  }

  function loadSelectedSessionMessages() {
    if (!selectedSessionId) return Effect.void

    const selectedSession = sessions.find(
      (session) => session.id === selectedSessionId
    )
    if (selectedSession) projectStore.selectProject(selectedSession.projectId)
    return messagesStore.loadMessages(selectedSessionId)
  }

  function clear() {
    sessions = []
    navigationConnectionId = null
    selectedSessionId = null
    settledSessionIds = new Set()
    loading = false
    error = null
    stoppingRuns = new Set()
    queuedMessages = new Map()
    pendingRunStarts = new Map()
    sessionStatuses = new Map()
    activeRuns = new Map()
    latestRunStart = null
    runStartSequence = 0
  }

  return {
    get sessions() {
      return sessions
    },
    get selectedSessionId() {
      return selectedSessionId
    },
    get selectedSession() {
      return (
        sessions.find((session) => session.id === selectedSessionId) ?? null
      )
    },
    get settledSessionIds() {
      return settledSessionIds
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    selectSession,
    startNewSession,
    settleSession,
    unsettleSession,
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
    createSession,
    runAgent,
    compactRange,
    stopAgent,
    fetchSessions,
    loadSelectedSessionMessages,
    clear,
  }
}

export const sessionStore = createSessionStore()
