/**
 * Messages store — persisted messages scoped to each tab plus streaming content
 * for the selected run in the active tab.
 *
 * Heavy content SSE is run-scoped: `/events?runId=...&since=...`. The global
 * SSE stream still carries lifecycle events used by the session store.
 */
import { apiClient, runApiEffect } from '$lib/api-client.js'
import type { UiApiError } from '$lib/api-errors.js'
import type {
  MessageNode,
  MessagePart,
  ActiveRunSummary,
  RunAttachment,
  StreamCursor,
} from '$lib/types.js'
import { Effect, Fiber, Stream } from 'effect'
import { serverEvents, type SseError } from '$lib/sse.js'
import { preloadMessageToolDiffs } from '$lib/tool-output.js'
import { sseStore } from './sse.svelte.js'
import { connectionsStore } from './connections.svelte.js'
import { requestSessionRefresh } from './session-refresh-bus.js'

interface MessageTabState {
  readonly sessionId: string | null
  readonly messages: MessageNode[]
  readonly loading: boolean
  readonly loaded: boolean
  readonly error: string | null
}

export interface BackgroundSummaryRun {
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly parentRunId: string | undefined
  readonly title: string
  readonly text: string
}

const emptyTabState: MessageTabState = {
  sessionId: null,
  messages: [],
  loading: false,
  loaded: false,
  error: null,
}

function createMessagesStore() {
  let tabStates = $state<Record<string, MessageTabState>>({})

  let streamingParts = $state<MessagePart[]>([])
  let backgroundSummaries = $state(new Map<string, BackgroundSummaryRun>())
  const lastCursors = new Map<string, StreamCursor>()

  let streamFiber: Fiber.Fiber<void, SseError> | null = null
  const backgroundFibers = new Map<string, Fiber.Fiber<void, SseError>>()
  let streamedTabId = $state<string | null>(null)
  let streamedSessionId = $state<string | null>(null)
  let streamedRunId = $state<string | null>(null)
  let streamedRunBaseNodeId = $state<string | null>(null)
  let finalRunRefreshes = $state<Record<string, ReadonlySet<string>>>({})

  function updateTabState(
    tabId: string,
    update: (state: MessageTabState) => MessageTabState
  ) {
    tabStates = {
      ...tabStates,
      [tabId]: update(tabStates[tabId] ?? emptyTabState),
    }
  }

  function stateFor(tabId: string | null): MessageTabState {
    return tabId === null ? emptyTabState : (tabStates[tabId] ?? emptyTabState)
  }

  function loadedTabsForSession(sessionId: string): ReadonlyArray<string> {
    return Object.entries(tabStates)
      .filter(([, state]) => state.sessionId === sessionId && state.loaded)
      .map(([tabId]) => tabId)
  }

  const getLastCursor = (runId: string) => lastCursors.get(runId) ?? null

  const setRunCursor = (runId: string) => {
    lastCursors.set(runId, { runId, eventId: 0 })
  }

  const setContentCursor = (runId: string, eventId: number) => {
    const prev = getLastCursor(runId)
    if (!prev || eventId > prev.eventId) {
      lastCursors.set(runId, { runId, eventId })
    }
  }

  const resetCursor = (runId?: string) => {
    if (runId === undefined) {
      lastCursors.clear()
      return
    }
    lastCursors.delete(runId)
  }

  function markFinalRunRefresh(tabId: string, runId: string) {
    finalRunRefreshes = {
      ...finalRunRefreshes,
      [tabId]: new Set([...(finalRunRefreshes[tabId] ?? []), runId]),
    }
  }

  function clearFinalRunRefresh(tabId: string, runId: string) {
    const existing = finalRunRefreshes[tabId]
    if (!existing?.has(runId)) return

    const nextSet = new Set(existing)
    nextSet.delete(runId)
    finalRunRefreshes = {
      ...finalRunRefreshes,
      [tabId]: nextSet,
    }
  }

  function closeRunStream() {
    if (streamFiber) Effect.runFork(Fiber.interrupt(streamFiber))
    streamFiber = null
  }

  function closeBackgroundStream(runId: string) {
    const fiber = backgroundFibers.get(runId)
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
    backgroundFibers.delete(runId)
  }

  function closeBackgroundStreams() {
    for (const runId of backgroundFibers.keys()) closeBackgroundStream(runId)
  }

  function openRunStream(tabId: string, sessionId: string, runId: string) {
    closeRunStream()

    const apiBase = connectionsStore.getApiBase()
    if (!apiBase) return

    streamFiber = Effect.runFork(
      serverEvents(apiBase, {
        runId,
        getSince: () => getLastCursor(runId),
      }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (!('sessionId' in event) || event.sessionId !== sessionId) return
            if (stateFor(tabId).sessionId !== sessionId) {
              closeRunStream()
              return
            }
            if ('runId' in event && event.runId !== streamedRunId) return

            switch (event._tag) {
              case 'RunStart':
                streamedRunId = event.runId
                streamedRunBaseNodeId = event.baseNodeId
                streamingParts = []
                setRunCursor(event.runId)
                void Effect.runPromise(refreshMessages(tabId, sessionId))
                break

              case 'TextDelta':
                setContentCursor(event.runId, event.eventId)
                appendTextDelta(event.delta)
                break

              case 'ReasoningDelta':
                setContentCursor(event.runId, event.eventId)
                appendReasoningDelta(event.delta)
                break

              case 'ToolCall':
                setContentCursor(event.runId, event.eventId)
                streamingParts = [
                  ...streamingParts,
                  {
                    type: 'tool-call',
                    id: event.id,
                    name: event.name,
                    params: event.params,
                    header: event.header,
                  },
                ]
                break

              case 'ToolResult':
                setContentCursor(event.runId, event.eventId)
                streamingParts = [
                  ...streamingParts,
                  {
                    type: 'tool-result',
                    id: event.id,
                    name: event.name,
                    result: event.result,
                    header: event.header,
                    bodyDisplay: event.bodyDisplay,
                    isFailure: event.isFailure,
                  },
                ]
                break

              case 'RunEnd':
                break

              case 'RunFailed':
                requestSessionRefresh(sessionId)
                break

              case 'ReplayReset':
                requestSessionRefresh(sessionId)
                void Effect.runPromise(
                  refreshMessages(tabId, sessionId, {
                    clearPartsForRun: event.runId,
                  })
                )
                break

              case 'MessagesAppended':
                break

              case 'SessionUpdated':
                break
            }
          })
        )
      )
    )
  }

  function openBackgroundSummaryStream(summary: BackgroundSummaryRun) {
    if (backgroundFibers.has(summary.runId)) return

    const apiBase = connectionsStore.getApiBase()
    if (!apiBase) return

    resetCursor(summary.runId)
    setRunCursor(summary.runId)

    const fiber = Effect.runFork(
      serverEvents(apiBase, {
        runId: summary.runId,
        getSince: () => getLastCursor(summary.runId),
      }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (
              !('sessionId' in event) ||
              event.sessionId !== summary.sessionId
            )
              return
            if ('runId' in event && event.runId !== summary.runId) return

            switch (event._tag) {
              case 'RunStart':
                setRunCursor(event.runId)
                break

              case 'TextDelta':
                setContentCursor(event.runId, event.eventId)
                appendBackgroundSummaryDelta(event.runId, event.delta)
                break

              case 'RunEnd':
                removeBackgroundSummary(event.runId)
                break

              case 'RunFailed':
              case 'ReplayReset':
                removeBackgroundSummary(event.runId)
                break

              case 'ReasoningDelta':
              case 'ToolCall':
              case 'ToolResult':
              case 'MessagesAppended':
              case 'RunRetrying':
              case 'SessionUpdated':
                break
            }
          })
        )
      )
    )
    backgroundFibers.set(summary.runId, fiber)
  }

  function selectRunStream(
    tabId: string,
    sessionId: string,
    runId: string | null,
    baseNodeId: string | null = null
  ) {
    if (runId === null) {
      closeRunStream()
      if (streamedRunId !== null) resetCursor(streamedRunId)
      streamedTabId = null
      streamedSessionId = null
      streamedRunId = null
      streamedRunBaseNodeId = null
      streamingParts = []
      return
    }

    if (
      streamedTabId === tabId &&
      streamedSessionId === sessionId &&
      streamedRunId === runId &&
      streamFiber !== null
    )
      return

    if (streamedRunId !== null) resetCursor(streamedRunId)
    streamingParts = []
    resetCursor(runId)
    clearFinalRunRefresh(tabId, runId)
    streamedTabId = tabId
    streamedSessionId = sessionId
    streamedRunId = runId
    streamedRunBaseNodeId = baseNodeId
    openRunStream(tabId, sessionId, runId)
  }

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

  function appendReasoningDelta(delta: string) {
    const last = streamingParts[streamingParts.length - 1]
    if (last && last.type === 'reasoning') {
      streamingParts = [
        ...streamingParts.slice(0, -1),
        { type: 'reasoning', text: last.text + delta },
      ]
    } else {
      streamingParts = [...streamingParts, { type: 'reasoning', text: delta }]
    }
  }

  function appendBackgroundSummaryDelta(runId: string, delta: string) {
    const existing = backgroundSummaries.get(runId)
    if (!existing) return

    const next = new Map(backgroundSummaries)
    next.set(runId, { ...existing, text: existing.text + delta })
    backgroundSummaries = next
  }

  function removeBackgroundSummary(runId: string) {
    closeBackgroundStream(runId)
    resetCursor(runId)
    if (!backgroundSummaries.has(runId)) return

    const next = new Map(backgroundSummaries)
    next.delete(runId)
    backgroundSummaries = next
  }

  function hydrateBackgroundSummaries(runs: ReadonlyArray<ActiveRunSummary>) {
    for (const run of runs) {
      if (run.kind !== 'summary' || run.visibility !== 'background') continue
      if (backgroundSummaries.has(run.runId)) continue

      const summary = {
        sessionId: run.sessionId,
        runId: run.runId,
        baseNodeId: run.baseNodeId,
        parentRunId: run.parentRunId,
        title: run.title ?? 'Generating summary',
        text: '',
      }
      const next = new Map(backgroundSummaries)
      next.set(run.runId, summary)
      backgroundSummaries = next
      openBackgroundSummaryStream(summary)
    }
  }

  function prepareSession(tabId: string, sessionId: string) {
    updateTabState(tabId, () => ({
      sessionId,
      messages: [],
      loading: false,
      loaded: true,
      error: null,
    }))
    if (streamedTabId === tabId) clearActiveStream()
  }

  function loadMessages(
    tabId: string,
    sessionId: string,
    opts?: { readonly force?: boolean }
  ) {
    const markLoaded = Effect.sync(() => {
      updateTabState(tabId, (state) => ({
        ...state,
        sessionId,
        loading: false,
        loaded: true,
      }))
    })

    return Effect.gen(function* () {
      const existing = stateFor(tabId)
      const hasExisting =
        existing.sessionId === sessionId && existing.loaded === true
      if (hasExisting && !opts?.force) return

      yield* Effect.sync(() => {
        if (streamedTabId === tabId) {
          streamingParts = []
          resetCursor()
          streamedTabId = null
          streamedSessionId = null
          streamedRunId = null
          streamedRunBaseNodeId = null
          closeRunStream()
        }

        if (!hasExisting) {
          updateTabState(tabId, (state) => ({
            ...state,
            sessionId,
            loading: true,
            loaded: false,
            error: null,
          }))
        } else {
          updateTabState(tabId, (state) => ({ ...state, error: null }))
        }
      })

      const client = yield* apiClient(connectionsStore.getApiBase())
      const response = yield* runApiEffect(
        client.sessions.messages({ params: { id: sessionId } }),
        'Failed to load messages'
      )
      const serverMessages = [...response]
      yield* Effect.promise(() => preloadMessageToolDiffs(serverMessages))

      yield* Effect.sync(() => {
        if (!(hasExisting && serverMessages.length === 0)) {
          updateTabState(tabId, (state) => ({
            ...state,
            sessionId,
            messages: serverMessages,
          }))
        }
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          const existing = stateFor(tabId)
          const hasExisting =
            existing.sessionId === sessionId && existing.loaded === true
          updateTabState(tabId, (state) => ({
            ...state,
            sessionId,
            messages: hasExisting ? state.messages : [],
            error: cause.message,
          }))
        })
      ),
      Effect.ensuring(markLoaded)
    )
  }

  function addOptimisticUserMessage(
    tabId: string,
    sessionId: string,
    input: string,
    attachments: ReadonlyArray<RunAttachment>,
    parentNodeId: string | null,
    runId: string
  ) {
    const now = Date.now()
    const optimistic: MessageNode = {
      id: `optimistic-${runId}`,
      sessionId,
      parentId: parentNodeId,
      kind: 'message',
      messageId: null,
      summaryId: null,
      sourceNodeId: null,
      runId,
      run: {
        id: runId,
        status: 'running',
        providerId: '',
        modelId: '',
        billingMode: 'api-key',
        usage: {
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          totalTokens: null,
          contextWindowTokens: null,
          actualCostMicrosUsd: null,
          listPriceMicrosUsd: null,
        },
        createdAt: now,
        completedAt: null,
      },
      modelCall: null,
      encoded: {
        role: 'user',
        content:
          attachments.length === 0
            ? input
            : [
                ...(input.length > 0
                  ? [{ type: 'text' as const, text: input }]
                  : []),
                ...attachments.map((attachment) => ({
                  type: 'file' as const,
                  mediaType: attachment.mediaType,
                  fileName: attachment.fileName,
                  data: attachment.data,
                })),
              ],
      },
      createdAt: now,
    }
    updateTabState(tabId, (state) => ({
      ...state,
      sessionId,
      messages: [...state.messages, optimistic],
      loaded: true,
      error: null,
    }))
  }

  function refreshMessages(
    tabId: string,
    sessionId: string,
    opts?: {
      clearPartsForRun?: string
      clearStreamingPartsForRun?: string
      markFinalRefreshForRun?: string
    }
  ) {
    return Effect.gen(function* () {
      if (stateFor(tabId).sessionId !== sessionId) return

      const client = yield* apiClient(connectionsStore.getApiBase())
      const response = yield* runApiEffect(
        client.sessions.messages({ params: { id: sessionId } }),
        'Failed to refresh messages'
      )
      const fresh = [...response]
      yield* Effect.promise(() => preloadMessageToolDiffs(fresh))

      yield* Effect.sync(() => {
        updateTabState(tabId, (state) => ({
          ...state,
          sessionId,
          messages: fresh,
          loaded: true,
          error: null,
        }))

        if (opts?.markFinalRefreshForRun) {
          markFinalRunRefresh(tabId, opts.markFinalRefreshForRun)
        }

        if (streamedTabId === tabId && streamedSessionId === sessionId) {
          if (
            opts?.clearStreamingPartsForRun &&
            streamedRunId === opts.clearStreamingPartsForRun
          ) {
            streamingParts = []
          }
          if (
            opts?.clearPartsForRun &&
            streamedRunId === opts.clearPartsForRun
          ) {
            streamingParts = []
            resetCursor(opts.clearPartsForRun)
            streamedRunId = null
            streamedRunBaseNodeId = null
            closeRunStream()
          }
        }
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.logError('Failed to refresh messages', {
          cause,
        })
      )
    )
  }

  sseStore.onEvent((event) => {
    if (
      event._tag === 'RunStart' &&
      event.kind === 'summary' &&
      event.visibility === 'background'
    ) {
      const summary = {
        sessionId: event.sessionId,
        runId: event.runId,
        baseNodeId: event.baseNodeId,
        parentRunId: event.parentRunId,
        title: event.title ?? 'Summarizing selected range',
        text: '',
      }
      const next = new Map(backgroundSummaries)
      next.set(event.runId, summary)
      backgroundSummaries = next
      openBackgroundSummaryStream(summary)
    }
    if (event._tag === 'MessagesAppended') {
      for (const tabId of loadedTabsForSession(event.sessionId)) {
        void Effect.runPromise(
          refreshMessages(tabId, event.sessionId, {
            clearStreamingPartsForRun: event.runId,
          })
        )
      }
    }
    if (event._tag === 'RunEnd') {
      removeBackgroundSummary(event.runId)
      for (const tabId of loadedTabsForSession(event.sessionId)) {
        void Effect.runPromise(
          refreshMessages(tabId, event.sessionId, {
            clearPartsForRun: event.runId,
            markFinalRefreshForRun: event.runId,
          })
        )
      }
    }
  })

  function clearTab(tabId: string) {
    if (streamedTabId === tabId) {
      closeRunStream()
      streamingParts = []
      resetCursor()
      streamedTabId = null
      streamedSessionId = null
      streamedRunId = null
      streamedRunBaseNodeId = null
    }
    const nextRefreshes = { ...finalRunRefreshes }
    delete nextRefreshes[tabId]
    finalRunRefreshes = nextRefreshes
    const next = { ...tabStates }
    delete next[tabId]
    tabStates = next
  }

  function clearActiveStream() {
    closeRunStream()
    closeBackgroundStreams()
    streamingParts = []
    backgroundSummaries = new Map()
    resetCursor()
    streamedTabId = null
    streamedSessionId = null
    streamedRunId = null
    streamedRunBaseNodeId = null
    finalRunRefreshes = {}
  }

  function clearAll() {
    clearActiveStream()
    tabStates = {}
  }

  return {
    get streamingParts() {
      return streamingParts
    },
    get activeRunId() {
      return streamedRunId
    },
    get activeRunBaseNodeId() {
      return streamedRunBaseNodeId
    },
    get activeStreamTabId() {
      return streamedTabId
    },
    backgroundSummariesForSession(sessionId: string | null) {
      if (sessionId === null) return []
      return [...backgroundSummaries.values()].filter(
        (summary) => summary.sessionId === sessionId
      )
    },
    hydrateBackgroundSummaries,
    messagesForTab(tabId: string | null) {
      return stateFor(tabId).messages
    },
    loadingForTab(tabId: string | null) {
      return stateFor(tabId).loading
    },
    loadedForTab(tabId: string | null) {
      return stateFor(tabId).loaded
    },
    finalRunRefreshCompletedForTab(tabId: string | null, runId: string) {
      return tabId !== null && (finalRunRefreshes[tabId]?.has(runId) ?? false)
    },
    errorForTab(tabId: string | null) {
      return stateFor(tabId).error
    },
    streamingPartsForTab(tabId: string | null) {
      return streamedTabId === tabId ? streamingParts : []
    },
    prepareSession,
    loadMessages,
    selectRunStream,
    addOptimisticUserMessage,
    clearTab,
    clearActiveStream,
    clearAll,
    clear: clearAll,
  }
}

export const messagesStore = createMessagesStore()
