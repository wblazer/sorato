/**
 * Messages store — persisted messages scoped to each tab plus streaming content
 * for the selected run in the active tab.
 *
 * Heavy content SSE is run-scoped: `/events?runId=...&since=...`. The global
 * SSE stream still carries lifecycle events used by the session store.
 */
import {
  MessageToolPreloader,
  MessagesApi,
  ServerEventSource,
} from '$lib/connection-services.js'
import {
  runConnectionFork,
  runConnectionPromise,
} from '$lib/connection-runtime.js'
import type { UiApiError } from '$lib/api-errors.js'
import type {
  MessageNode,
  ActiveRunSummary,
  RunAttachment,
  StreamCursor,
  ServerEvent,
} from '$lib/types.js'
import type { ContentEvent } from '@sorato/api'
import {
  acknowledgeContentThrough,
  appendContentEvent,
  applyConversationSnapshot,
  applyDurableNodeBatch,
  emptyStreamContentState,
  type DurableNodeBatch,
  type StreamContentState,
} from '$lib/conversation-sync.js'
import { Effect, Fiber, Stream } from 'effect'
import type { SseError } from '$lib/sse.js'
import { sseStore } from './sse.svelte.js'
import { requestSessionRefresh } from './session-refresh-bus.js'
import { MessageRefreshOrder } from './message-refresh-order.js'
import { activeRunFromUpserted } from '$lib/active-run-events.js'

interface MessageTabState {
  readonly sessionId: string | null
  readonly messages: MessageNode[]
  readonly loading: boolean
  readonly loaded: boolean
  readonly error: string | null
  readonly sequence: number
  readonly pendingSnapshots: number
  readonly bufferedBatches: ReadonlyArray<DurableNodeBatch>
}

type NodeBatchCommittedEvent = Extract<
  ServerEvent,
  { readonly _tag: 'NodeBatchCommitted' }
>
type RunEndEvent = Extract<ServerEvent, { readonly _tag: 'RunEnd' }>

export interface BackgroundSummaryRun {
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly parentRunId: string | undefined
  readonly title: string
  readonly text: string
  readonly content: StreamContentState
}

const emptyTabState: MessageTabState = {
  sessionId: null,
  messages: [],
  loading: false,
  loaded: false,
  error: null,
  sequence: 0,
  pendingSnapshots: 0,
  bufferedBatches: [],
}

function createMessagesStore() {
  let tabStates = $state<Record<string, MessageTabState>>({})

  let streamContent = $state<StreamContentState>(emptyStreamContentState)
  let backgroundSummaries = $state(new Map<string, BackgroundSummaryRun>())
  const lastCursors = new Map<string, StreamCursor>()
  const refreshOrder = new MessageRefreshOrder()

  let streamFiber: Fiber.Fiber<void, SseError> | null = null
  const backgroundFibers = new Map<string, Fiber.Fiber<void, SseError>>()
  let streamedTabId = $state<string | null>(null)
  let streamedSessionId = $state<string | null>(null)
  let streamedRunId = $state<string | null>(null)
  let streamedRunBaseNodeId = $state<string | null>(null)
  let durableRunCompletions = $state<
    Record<string, ReadonlyMap<string, string | null>>
  >({})
  const latestCommittedRunHeads = new Map<string, string>()
  const endedRuns = new Set<string>()
  const runStreamEndedRuns = new Set<string>()
  const watermarkedRuns = new Set<string>()
  const finalizedRuns = new Set<string>()
  const runEndSequences = new Map<string, number>()

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
      .filter(
        ([, state]) =>
          state.sessionId === sessionId &&
          (state.loaded || state.pendingSnapshots > 0)
      )
      .map(([tabId]) => tabId)
  }

  function resetStreamContent() {
    streamContent = emptyStreamContentState
  }

  function hasCanonicalRunContent(sessionId: string, runId: string): boolean {
    return loadedTabsForSession(sessionId).some((tabId) =>
      stateFor(tabId).messages.some(
        (node) =>
          node.runId === runId &&
          !node.id.startsWith('optimistic-') &&
          node.run !== null &&
          node.run.status !== 'running' &&
          (node.encoded.role === 'assistant' || node.encoded.role === 'tool')
      )
    )
  }

  function finalizeRunIfDurable(sessionId: string, runId: string) {
    if (finalizedRuns.has(runId)) return
    if (!endedRuns.has(runId)) return
    if (
      !watermarkedRuns.has(runId) &&
      !hasCanonicalRunContent(sessionId, runId) &&
      !(
        runStreamEndedRuns.has(runId) &&
        streamedRunId === runId &&
        streamContent.events.length === 0
      )
    )
      return
    if (streamedRunId === runId && streamContent.events.length > 0) return

    for (const tabId of loadedTabsForSession(sessionId)) {
      markDurableRunCompletion(
        tabId,
        runId,
        latestCommittedRunHeads.get(runId) ?? null
      )
    }
    endedRuns.delete(runId)
    runStreamEndedRuns.delete(runId)
    watermarkedRuns.delete(runId)
    finalizedRuns.add(runId)

    if (streamedRunId === runId) {
      closeRunStream()
      resetCursor(runId)
      resetStreamContent()
      streamedRunId = null
      streamedRunBaseNodeId = null
    }
  }

  function advanceDurableSequence(
    sessionId: string,
    sequence: number,
    runId = ''
  ) {
    const mutation: DurableNodeBatch = { sequence, runId, nodes: [] }
    for (const tabId of loadedTabsForSession(sessionId)) {
      updateTabState(tabId, (state) => {
        if (sequence <= state.sequence) return state
        return {
          ...state,
          sequence,
          bufferedBatches:
            state.pendingSnapshots > 0
              ? [...state.bufferedBatches, mutation]
              : state.bufferedBatches,
        }
      })
    }
  }

  function applyNodeBatch(event: NodeBatchCommittedEvent) {
    const batch: DurableNodeBatch = {
      sequence: event.sequence,
      runId: event.runId,
      nodes: event.nodes,
    }
    let applied = false
    latestCommittedRunHeads.set(event.runId, event.headNodeId)

    for (const tabId of loadedTabsForSession(event.sessionId)) {
      updateTabState(tabId, (state) => {
        const next = applyDurableNodeBatch(
          { sequence: state.sequence, nodes: state.messages },
          batch
        )
        if (next.sequence === state.sequence) return state
        applied = true
        return {
          ...state,
          messages: [...next.nodes],
          sequence: next.sequence,
          bufferedBatches:
            state.pendingSnapshots > 0
              ? [...state.bufferedBatches, batch]
              : state.bufferedBatches,
          loaded: true,
          loading: next.nodes.length === 0 ? state.loading : false,
          error: null,
        }
      })
    }

    if (event.contentThroughEventId !== undefined) {
      watermarkedRuns.add(event.runId)
      if (streamedRunId === event.runId) {
        streamContent = acknowledgeContentThrough(
          streamContent,
          event.contentThroughEventId
        )
      }
      if (applied) {
        acknowledgeBackgroundSummaryThrough(
          event.runId,
          event.contentThroughEventId
        )
      }
    }

    if (applied && backgroundSummaries.has(event.runId)) {
      removeBackgroundSummary(event.runId)
    }

    if (applied) {
      void runConnectionPromise(
        MessageToolPreloader.pipe(
          Effect.flatMap((preloader) => preloader.preloadMessages(event.nodes))
        )
      )
    }
    finalizeRunIfDurable(event.sessionId, event.runId)
  }

  function handleRunStreamEnd(event: RunEndEvent) {
    if (finalizedRuns.has(event.runId)) return
    runStreamEndedRuns.add(event.runId)
    finalizeRunIfDurable(event.sessionId, event.runId)
  }

  function handleDurableRunEnd(event: RunEndEvent) {
    if (finalizedRuns.has(event.runId)) return
    const previousSequence = runEndSequences.get(event.runId) ?? 0
    if (event.sequence < previousSequence) return
    if (event.sequence > previousSequence) {
      runEndSequences.set(event.runId, event.sequence)
      advanceDurableSequence(event.sessionId, event.sequence, event.runId)
      endedRuns.add(event.runId)
    }
    finalizeRunIfDurable(event.sessionId, event.runId)
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

  function markDurableRunCompletion(
    tabId: string,
    runId: string,
    focusNodeId: string | null
  ) {
    const completions = new Map(durableRunCompletions[tabId] ?? [])
    completions.set(runId, focusNodeId)
    durableRunCompletions = {
      ...durableRunCompletions,
      [tabId]: completions,
    }
  }

  function clearDurableRunCompletion(tabId: string, runId: string) {
    const existing = durableRunCompletions[tabId]
    if (!existing?.has(runId)) return

    const nextCompletions = new Map(existing)
    nextCompletions.delete(runId)
    durableRunCompletions = {
      ...durableRunCompletions,
      [tabId]: nextCompletions,
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

  function acceptContentEvent(event: ContentEvent) {
    setContentCursor(event.runId, event.eventId)
    streamContent = appendContentEvent(streamContent, event)

    if (
      event._tag === 'ToolResult' &&
      event.bodyDisplay?.type === 'inline-diff'
    ) {
      const bodyDisplay = event.bodyDisplay
      void runConnectionPromise(
        MessageToolPreloader.pipe(
          Effect.flatMap((preloader) =>
            preloader.preloadTool(bodyDisplay, event.id)
          )
        )
      )
    }
  }

  function openRunStream(tabId: string, sessionId: string, runId: string) {
    closeRunStream()

    streamFiber = runConnectionFork(
      Effect.gen(function* () {
        const events = yield* ServerEventSource
        yield* events
          .stream({
            runId,
            getSince: () => getLastCursor(runId),
          })
          .pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (!('sessionId' in event) || event.sessionId !== sessionId)
                  return
                if (stateFor(tabId).sessionId !== sessionId) {
                  closeRunStream()
                  return
                }
                if ('runId' in event && event.runId !== streamedRunId) return

                switch (event._tag) {
                  case 'RunStart':
                    streamedRunId = event.runId
                    streamedRunBaseNodeId = event.baseNodeId
                    break

                  case 'TextDelta':
                  case 'ReasoningDelta':
                  case 'ToolCall':
                  case 'ToolResult':
                    acceptContentEvent(event)
                    break

                  case 'RunFailed':
                    requestSessionRefresh(sessionId)
                    break

                  case 'ReplayReset':
                    requestSessionRefresh(sessionId)
                    break

                  case 'RunBaseUpdated':
                    streamedRunBaseNodeId = event.baseNodeId
                    break

                  case 'RunEnd':
                    handleRunStreamEnd(event)
                    break
                  case 'NodeBatchCommitted':
                    applyNodeBatch(event)
                    break
                  case 'ActiveRunUpserted':
                  case 'SessionTitleUpdated':
                  case 'RunRetrying':
                    break
                }
              })
            )
          )
      })
    )
  }

  function openBackgroundSummaryStream(summary: BackgroundSummaryRun) {
    if (backgroundFibers.has(summary.runId)) return

    resetCursor(summary.runId)
    setRunCursor(summary.runId)

    const fiber = runConnectionFork(
      Effect.gen(function* () {
        const events = yield* ServerEventSource
        yield* events
          .stream({
            runId: summary.runId,
            getSince: () => getLastCursor(summary.runId),
          })
          .pipe(
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
                    break

                  case 'TextDelta':
                    setContentCursor(event.runId, event.eventId)
                    appendBackgroundSummaryEvent(event)
                    break

                  case 'RunEnd':
                    handleRunStreamEnd(event)
                    break

                  case 'RunFailed':
                  case 'ReplayReset':
                    removeBackgroundSummary(event.runId)
                    break

                  case 'ReasoningDelta':
                  case 'ToolCall':
                  case 'ToolResult':
                  case 'RunRetrying':
                  case 'ActiveRunUpserted':
                  case 'SessionTitleUpdated':
                  case 'RunBaseUpdated':
                    break
                  case 'NodeBatchCommitted':
                    applyNodeBatch(event)
                    break
                }
              })
            )
          )
      })
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
      resetStreamContent()
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
    resetStreamContent()
    resetCursor(runId)
    clearDurableRunCompletion(tabId, runId)
    streamedTabId = tabId
    streamedSessionId = sessionId
    streamedRunId = runId
    streamedRunBaseNodeId = baseNodeId
    openRunStream(tabId, sessionId, runId)
  }

  function appendBackgroundSummaryEvent(event: ContentEvent) {
    const existing = backgroundSummaries.get(event.runId)
    if (!existing) return
    const content = appendContentEvent(existing.content, event)

    const next = new Map(backgroundSummaries)
    next.set(event.runId, {
      ...existing,
      content,
      text: content.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join(''),
    })
    backgroundSummaries = next
  }

  function acknowledgeBackgroundSummaryThrough(runId: string, eventId: number) {
    const existing = backgroundSummaries.get(runId)
    if (!existing) return
    const content = acknowledgeContentThrough(existing.content, eventId)

    const next = new Map(backgroundSummaries)
    next.set(runId, {
      ...existing,
      content,
      text: content.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join(''),
    })
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
      const existing = backgroundSummaries.get(run.runId)
      const summary: BackgroundSummaryRun = {
        sessionId: run.sessionId,
        runId: run.runId,
        baseNodeId: run.baseNodeId,
        parentRunId: run.parentRunId,
        title: run.title ?? 'Generating summary',
        text: existing?.text ?? '',
        content: existing?.content ?? emptyStreamContentState,
      }
      const next = new Map(backgroundSummaries)
      next.set(run.runId, summary)
      backgroundSummaries = next
      if (!backgroundFibers.has(run.runId)) openBackgroundSummaryStream(summary)
    }
  }

  function prepareSession(tabId: string, sessionId: string) {
    refreshOrder.clear(tabId)
    updateTabState(tabId, () => ({
      sessionId,
      messages: [],
      loading: false,
      loaded: true,
      error: null,
      sequence: 0,
      pendingSnapshots: 0,
      bufferedBatches: [],
    }))
    if (streamedTabId === tabId) clearActiveStream()
  }

  function loadMessages(
    tabId: string,
    sessionId: string,
    opts?: { readonly force?: boolean; readonly recoverRunId?: string }
  ) {
    let refreshRequest: number | undefined
    const commitIfFreshRequest = (commit: () => void) => {
      if (refreshRequest === undefined) {
        commit()
        return true
      }
      return refreshOrder.commitIfFresh(tabId, refreshRequest, commit)
    }
    const finishSnapshot = Effect.sync(() => {
      if (refreshRequest === undefined) return
      if (stateFor(tabId).sessionId !== sessionId) return
      updateTabState(tabId, (state) => {
        const pendingSnapshots = Math.max(0, state.pendingSnapshots - 1)
        return {
          ...state,
          pendingSnapshots,
          bufferedBatches: pendingSnapshots === 0 ? [] : state.bufferedBatches,
          loading:
            pendingSnapshots > 0 && (!state.loaded || state.error !== null),
        }
      })
    })

    return Effect.gen(function* () {
      const existing = stateFor(tabId)
      const hasExisting =
        existing.sessionId === sessionId &&
        existing.loaded === true &&
        existing.error === null
      if (hasExisting && !opts?.force) return
      const request = refreshOrder.begin()
      refreshRequest = request

      yield* Effect.sync(() => {
        updateTabState(tabId, (state) => {
          const sameSession = state.sessionId === sessionId
          const current = sameSession ? state : emptyTabState
          const baseline: DurableNodeBatch = {
            sequence: current.sequence,
            runId: '',
            nodes: current.messages,
          }
          return {
            ...current,
            sessionId,
            loading: !hasExisting,
            loaded: hasExisting,
            error: null,
            pendingSnapshots: current.pendingSnapshots + 1,
            bufferedBatches:
              current.pendingSnapshots === 0 && current.sequence > 0
                ? [baseline]
                : current.bufferedBatches,
          }
        })
      })

      const messages = yield* MessagesApi
      const snapshot = yield* messages.list(sessionId)
      const preloader = yield* MessageToolPreloader
      yield* preloader.preloadMessages(snapshot.nodes)

      yield* Effect.sync(() => {
        refreshOrder.commitIfFresh(tabId, request, () => {
          updateTabState(tabId, (state) => {
            const next = applyConversationSnapshot(
              { sequence: state.sequence, nodes: state.messages },
              snapshot,
              state.bufferedBatches
            )
            return {
              ...state,
              sessionId,
              messages: [...next.nodes],
              sequence: next.sequence,
              loaded: true,
              error: null,
            }
          })

          if (
            opts?.recoverRunId !== undefined &&
            streamedTabId === tabId &&
            streamedRunId === opts.recoverRunId
          ) {
            closeRunStream()
            resetCursor(opts.recoverRunId)
            resetStreamContent()
            streamedRunId = null
            streamedRunBaseNodeId = null
          }
        })
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          commitIfFreshRequest(() => {
            const existing = stateFor(tabId)
            const hasExisting =
              existing.sessionId === sessionId &&
              existing.loaded === true &&
              existing.error === null
            updateTabState(tabId, (state) => ({
              ...state,
              sessionId,
              messages: hasExisting ? state.messages : [],
              loaded: true,
              error: hasExisting ? null : cause.message,
            }))
          })
        })
      ),
      Effect.ensuring(finishSnapshot)
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
    const state = stateFor(tabId)
    const alreadyCommitted = state.messages.some(
      (message) =>
        message.runId === runId &&
        !message.id.startsWith('optimistic-') &&
        message.encoded.role === 'user'
    )
    if (alreadyCommitted) return

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
    updateTabState(tabId, (current) => ({
      ...current,
      sessionId,
      messages: [
        ...current.messages.filter((message) => message.id !== optimistic.id),
        optimistic,
      ],
      loaded: true,
      error: null,
    }))
  }

  sseStore.onEvent((event) => {
    if (event._tag === 'ActiveRunUpserted') {
      advanceDurableSequence(event.sessionId, event.sequence, event.runId)
      hydrateBackgroundSummaries([activeRunFromUpserted(event)])
    }
    if (event._tag === 'NodeBatchCommitted') {
      applyNodeBatch(event)
    }
    if (event._tag === 'ReplayReset') {
      for (const tabId of loadedTabsForSession(event.sessionId)) {
        void runConnectionPromise(
          loadMessages(tabId, event.sessionId, {
            force: true,
            recoverRunId: event.runId,
          })
        )
      }
    }
    if (event._tag === 'RunEnd') {
      handleDurableRunEnd(event)
    }
    if (event._tag === 'SessionTitleUpdated') {
      advanceDurableSequence(event.sessionId, event.sequence)
    }
  })

  function clearTab(tabId: string) {
    refreshOrder.clear(tabId)
    if (streamedTabId === tabId) {
      closeRunStream()
      resetStreamContent()
      resetCursor()
      streamedTabId = null
      streamedSessionId = null
      streamedRunId = null
      streamedRunBaseNodeId = null
    }
    const nextRefreshes = { ...durableRunCompletions }
    delete nextRefreshes[tabId]
    durableRunCompletions = nextRefreshes
    const next = { ...tabStates }
    delete next[tabId]
    tabStates = next
  }

  function clearActiveStream() {
    closeRunStream()
    closeBackgroundStreams()
    resetStreamContent()
    backgroundSummaries = new Map()
    resetCursor()
    streamedTabId = null
    streamedSessionId = null
    streamedRunId = null
    streamedRunBaseNodeId = null
    durableRunCompletions = {}
    endedRuns.clear()
    runStreamEndedRuns.clear()
    watermarkedRuns.clear()
    finalizedRuns.clear()
    runEndSequences.clear()
    latestCommittedRunHeads.clear()
  }

  function clearAll() {
    refreshOrder.clearAll()
    clearActiveStream()
    tabStates = {}
  }

  return {
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
    durableRunFocusForTab(
      tabId: string | null,
      runId: string
    ): string | null | undefined {
      return tabId === null
        ? undefined
        : durableRunCompletions[tabId]?.get(runId)
    },
    errorForTab(tabId: string | null) {
      return stateFor(tabId).error
    },
    streamingPartsForTab(tabId: string | null) {
      return streamedTabId === tabId ? streamContent.parts : []
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
