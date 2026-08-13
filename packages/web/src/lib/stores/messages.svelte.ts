/**
 * Messages store — persisted messages and streaming content for the single
 * active session.
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

interface MessageState {
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

export interface BackgroundChildRun {
  readonly sessionId: string
  readonly runId: string
  readonly baseNodeId: string | null
  readonly kind: ActiveRunSummary['kind']
  readonly parentRunId: string | undefined
  readonly title: string
  readonly text: string
  readonly content: StreamContentState
}

const emptyMessageState: MessageState = {
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
  let messageState = $state<MessageState>(emptyMessageState)

  let streamContent = $state<StreamContentState>(emptyStreamContentState)
  let backgroundChildRuns = $state(new Map<string, BackgroundChildRun>())
  const lastCursors = new Map<string, StreamCursor>()
  const refreshOrder = new MessageRefreshOrder()

  let streamFiber: Fiber.Fiber<void, SseError> | null = null
  let backgroundFiber: Fiber.Fiber<void, SseError> | null = null
  let streamedSessionId = $state<string | null>(null)
  let streamedRunId = $state<string | null>(null)
  let streamedRunBaseNodeId = $state<string | null>(null)
  let durableRunCompletions = $state<ReadonlyMap<string, string | null>>(
    new Map()
  )
  const latestCommittedRunHeads = new Map<string, string>()
  const endedRuns = new Set<string>()
  const runStreamEndedRuns = new Set<string>()
  const watermarkedRuns = new Set<string>()
  const finalizedRuns = new Set<string>()
  const runEndSequences = new Map<string, number>()

  function updateMessageState(update: (state: MessageState) => MessageState) {
    messageState = update(messageState)
  }

  function hasLoadedSession(sessionId: string): boolean {
    return (
      messageState.sessionId === sessionId &&
      (messageState.loaded || messageState.pendingSnapshots > 0)
    )
  }

  function resetStreamContent() {
    streamContent = emptyStreamContentState
  }

  function hasCanonicalRunContent(sessionId: string, runId: string): boolean {
    return (
      hasLoadedSession(sessionId) &&
      messageState.messages.some(
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

    if (hasLoadedSession(sessionId)) {
      markDurableRunCompletion(
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
    if (!hasLoadedSession(sessionId)) return
    updateMessageState((state) => {
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

  function applyNodeBatch(event: NodeBatchCommittedEvent) {
    const batch: DurableNodeBatch = {
      sequence: event.sequence,
      runId: event.runId,
      nodes: event.nodes,
    }
    let applied = false
    latestCommittedRunHeads.set(event.runId, event.headNodeId)

    if (hasLoadedSession(event.sessionId)) {
      updateMessageState((state) => {
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
        acknowledgeBackgroundChildRunThrough(
          event.runId,
          event.contentThroughEventId
        )
      }
    }

    if (applied && backgroundChildRuns.has(event.runId)) {
      removeBackgroundChildRun(event.runId)
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

  function markDurableRunCompletion(runId: string, focusNodeId: string | null) {
    const completions = new Map(durableRunCompletions)
    completions.set(runId, focusNodeId)
    durableRunCompletions = completions
  }

  function clearDurableRunCompletion(runId: string) {
    if (!durableRunCompletions.has(runId)) return

    const nextCompletions = new Map(durableRunCompletions)
    nextCompletions.delete(runId)
    durableRunCompletions = nextCompletions
  }

  function closeRunStream() {
    if (streamFiber) Effect.runFork(Fiber.interrupt(streamFiber))
    streamFiber = null
  }

  function closeBackgroundStream() {
    if (backgroundFiber) Effect.runFork(Fiber.interrupt(backgroundFiber))
    backgroundFiber = null
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

  function openRunStream(sessionId: string, runId: string) {
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
                if (messageState.sessionId !== sessionId) {
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

  function openBackgroundChildRunStream() {
    const runs = [...backgroundChildRuns.values()]
    if (runs.length === 0) {
      closeBackgroundStream()
      return
    }

    closeBackgroundStream()
    for (const run of runs) {
      if (getLastCursor(run.runId) === null) setRunCursor(run.runId)
    }

    backgroundFiber = runConnectionFork(
      Effect.gen(function* () {
        const events = yield* ServerEventSource
        yield* events
          .stream({
            runIds: runs.map((run) => run.runId),
            getSinceForRun: getLastCursor,
          })
          .pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (!('runId' in event)) return
                const childRun = backgroundChildRuns.get(event.runId)
                if (
                  !childRun ||
                  !('sessionId' in event) ||
                  event.sessionId !== childRun.sessionId
                )
                  return

                switch (event._tag) {
                  case 'RunStart':
                    break

                  case 'TextDelta':
                  case 'ReasoningDelta':
                  case 'ToolCall':
                  case 'ToolResult':
                    setContentCursor(event.runId, event.eventId)
                    appendBackgroundChildRunEvent(event)
                    break

                  case 'RunEnd':
                  case 'RunFailed':
                  case 'ReplayReset':
                    removeBackgroundChildRun(event.runId)
                    break

                  case 'RunRetrying':
                  case 'RunBaseUpdated':
                    break
                }
              })
            )
          )
      })
    )
  }

  function selectRunStream(
    sessionId: string,
    runId: string | null,
    baseNodeId: string | null = null
  ) {
    if (runId === null) {
      closeRunStream()
      if (streamedRunId !== null) resetCursor(streamedRunId)
      streamedSessionId = null
      streamedRunId = null
      streamedRunBaseNodeId = null
      resetStreamContent()
      return
    }

    if (
      streamedSessionId === sessionId &&
      streamedRunId === runId &&
      streamFiber !== null
    )
      return

    if (streamedRunId !== null) resetCursor(streamedRunId)
    resetStreamContent()
    resetCursor(runId)
    clearDurableRunCompletion(runId)
    streamedSessionId = sessionId
    streamedRunId = runId
    streamedRunBaseNodeId = baseNodeId
    openRunStream(sessionId, runId)
  }

  function appendBackgroundChildRunEvent(event: ContentEvent) {
    const existing = backgroundChildRuns.get(event.runId)
    if (!existing) return
    const content = appendContentEvent(existing.content, event)

    const next = new Map(backgroundChildRuns)
    next.set(event.runId, {
      ...existing,
      content,
      text: content.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join(''),
    })
    backgroundChildRuns = next
  }

  function acknowledgeBackgroundChildRunThrough(
    runId: string,
    eventId: number
  ) {
    const existing = backgroundChildRuns.get(runId)
    if (!existing) return
    const content = acknowledgeContentThrough(existing.content, eventId)

    const next = new Map(backgroundChildRuns)
    next.set(runId, {
      ...existing,
      content,
      text: content.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join(''),
    })
    backgroundChildRuns = next
  }

  function removeBackgroundChildRun(runId: string) {
    resetCursor(runId)
    if (!backgroundChildRuns.has(runId)) return

    const next = new Map(backgroundChildRuns)
    next.delete(runId)
    backgroundChildRuns = next
    if (next.size === 0) closeBackgroundStream()
  }

  function hydrateBackgroundChildRuns(runs: ReadonlyArray<ActiveRunSummary>) {
    let changed = false
    const next = new Map(backgroundChildRuns)
    for (const run of runs) {
      if (run.visibility !== 'background') continue
      const existing = next.get(run.runId)
      next.set(run.runId, {
        sessionId: run.sessionId,
        runId: run.runId,
        baseNodeId: run.baseNodeId,
        kind: run.kind,
        parentRunId: run.parentRunId,
        title:
          run.title ??
          (run.kind === 'summary' ? 'Generating summary' : 'Background agent'),
        text: existing?.text ?? '',
        content: existing?.content ?? emptyStreamContentState,
      })
      if (!existing) changed = true
    }
    backgroundChildRuns = next
    if (changed || (backgroundFiber === null && next.size > 0)) {
      openBackgroundChildRunStream()
    }
  }

  function prepareSession(sessionId: string) {
    refreshOrder.clear()
    clearActiveStream()
    messageState = {
      sessionId,
      messages: [],
      loading: false,
      loaded: true,
      error: null,
      sequence: 0,
      pendingSnapshots: 0,
      bufferedBatches: [],
    }
  }

  function loadMessages(
    sessionId: string,
    opts?: { readonly force?: boolean; readonly recoverRunId?: string }
  ) {
    let refreshRequest: number | undefined
    const commitIfFreshRequest = (commit: () => void) => {
      if (refreshRequest === undefined) {
        commit()
        return true
      }
      return refreshOrder.commitIfFresh(refreshRequest, commit)
    }
    const finishSnapshot = Effect.sync(() => {
      if (refreshRequest === undefined) return
      if (messageState.sessionId !== sessionId) return
      updateMessageState((state) => {
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
      const existing = messageState
      const hasExisting =
        existing.sessionId === sessionId &&
        existing.loaded === true &&
        existing.error === null
      if (hasExisting && !opts?.force) return
      const request = refreshOrder.begin()
      refreshRequest = request

      yield* Effect.sync(() => {
        if (messageState.sessionId !== sessionId) {
          selectRunStream(sessionId, null)
        }
        updateMessageState((state) => {
          const sameSession = state.sessionId === sessionId
          const current = sameSession ? state : emptyMessageState
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
        refreshOrder.commitIfFresh(request, () => {
          if (messageState.sessionId !== sessionId) return
          updateMessageState((state) => {
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
            streamedSessionId === sessionId &&
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
            if (messageState.sessionId !== sessionId) return
            const existing = messageState
            const hasExisting =
              existing.sessionId === sessionId &&
              existing.loaded === true &&
              existing.error === null
            updateMessageState((state) => ({
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
    sessionId: string,
    input: string,
    attachments: ReadonlyArray<RunAttachment>,
    parentNodeId: string | null,
    runId: string
  ) {
    const state = messageState
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
        kind: 'agent',
        systemPromptId: null,
        attribution: null,
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
    updateMessageState((current) => ({
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
      hydrateBackgroundChildRuns([activeRunFromUpserted(event)])
    }
    if (event._tag === 'NodeBatchCommitted') {
      applyNodeBatch(event)
    }
    if (event._tag === 'ReplayReset') {
      if (hasLoadedSession(event.sessionId)) {
        void runConnectionPromise(
          loadMessages(event.sessionId, {
            force: true,
            recoverRunId: event.runId,
          })
        )
      }
    }
    if (event._tag === 'RunEnd') {
      handleDurableRunEnd(event)
      removeBackgroundChildRun(event.runId)
    }
    if (event._tag === 'SessionTitleUpdated') {
      advanceDurableSequence(event.sessionId, event.sequence)
    }
  })

  function clearSession() {
    refreshOrder.clear()
    if (streamedSessionId === messageState.sessionId) {
      closeRunStream()
      resetStreamContent()
      resetCursor()
      streamedSessionId = null
      streamedRunId = null
      streamedRunBaseNodeId = null
    }
    durableRunCompletions = new Map()
    messageState = emptyMessageState
  }

  function clearActiveStream() {
    closeRunStream()
    closeBackgroundStream()
    resetStreamContent()
    backgroundChildRuns = new Map()
    resetCursor()
    streamedSessionId = null
    streamedRunId = null
    streamedRunBaseNodeId = null
    durableRunCompletions = new Map()
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
    messageState = emptyMessageState
  }

  return {
    get activeRunId() {
      return streamedRunId
    },
    get activeRunBaseNodeId() {
      return streamedRunBaseNodeId
    },
    backgroundChildRunsForSession(sessionId: string | null) {
      if (sessionId === null) return []
      return [...backgroundChildRuns.values()].filter(
        (childRun) => childRun.sessionId === sessionId
      )
    },
    hydrateBackgroundChildRuns,
    get messages() {
      return messageState.messages
    },
    get loading() {
      return messageState.loading
    },
    get loaded() {
      return messageState.loaded
    },
    durableRunFocus(runId: string): string | null | undefined {
      return durableRunCompletions.get(runId)
    },
    get error() {
      return messageState.error
    },
    get streamingParts() {
      return streamContent.parts
    },
    prepareSession,
    loadMessages,
    selectRunStream,
    addOptimisticUserMessage,
    clearSession,
    clearActiveStream,
    clearAll,
    clear: clearAll,
  }
}

export const messagesStore = createMessagesStore()
