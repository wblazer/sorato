/**
 * Messages store — persisted messages for the active session plus streaming
 * content for the selected run.
 *
 * Heavy content SSE is run-scoped: `/events?runId=...&since=...`. The global
 * SSE stream still carries lifecycle events used by the session store.
 */
import { getApiClient, runApi } from '$lib/api-client.js'
import { requestErrorMessage } from '$lib/api-errors.js'
import type { MessageNode, MessagePart, StreamCursor } from '$lib/types.js'
import { connectSse, type SseConnection } from '$lib/sse.js'
import { sseStore } from './sse.svelte.js'
import { connectionsStore } from './connections.svelte.js'
import { requestSessionRefresh } from './session-refresh-bus.js'

function createMessagesStore() {
  let messages = $state<MessageNode[]>([])
  let loading = $state(false)
  let loaded = $state(false)
  let error = $state<string | null>(null)
  let currentSessionId = $state<string | null>(null)

  let streamingParts = $state<MessagePart[]>([])
  const lastCursors = new Map<string, StreamCursor>()

  let streamConnection: SseConnection | null = null
  let streamedRunId = $state<string | null>(null)
  let streamedRunBaseNodeId = $state<string | null>(null)

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

  function closeRunStream() {
    streamConnection?.close()
    streamConnection = null
  }

  function openRunStream(sessionId: string, runId: string) {
    closeRunStream()

    const apiBase = connectionsStore.getApiBase()
    if (!apiBase) return

    streamConnection = connectSse(
      apiBase,
      (event) => {
        if (!('sessionId' in event) || event.sessionId !== currentSessionId)
          return
        if ('runId' in event && event.runId !== streamedRunId) return

        switch (event._tag) {
          case 'RunStart':
            streamedRunId = event.runId
            streamedRunBaseNodeId = event.baseNodeId
            streamingParts = []
            setRunCursor(event.runId)
            refreshMessages(sessionId)
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
            refreshMessages(sessionId, { clearPartsForRun: event.runId })
            break

          case 'RunFailed':
            requestSessionRefresh(sessionId)
            break

          case 'ReplayReset':
            requestSessionRefresh(sessionId)
            refreshMessages(sessionId, { clearPartsForRun: event.runId })
            break

          case 'MessagesAppended':
          case 'SessionUpdated':
            break
        }
      },
      {
        runId,
        getSince: () => getLastCursor(runId),
      }
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
      streamedRunId = null
      streamedRunBaseNodeId = null
      streamingParts = []
      return
    }

    if (currentSessionId !== sessionId) currentSessionId = sessionId
    if (streamedRunId === runId && streamConnection !== null) return

    if (streamedRunId !== null) resetCursor(streamedRunId)
    streamingParts = []
    resetCursor(runId)
    streamedRunId = runId
    streamedRunBaseNodeId = baseNodeId
    openRunStream(sessionId, runId)
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

  function prepareSession(sessionId: string) {
    messages = []
    currentSessionId = sessionId
    loading = false
    loaded = true
    error = null
    streamingParts = []
    resetCursor()
    streamedRunId = null
    streamedRunBaseNodeId = null
    closeRunStream()
  }

  async function loadMessages(sessionId: string) {
    const hasExisting = currentSessionId === sessionId && messages.length > 0

    streamingParts = []
    resetCursor()
    streamedRunId = null
    streamedRunBaseNodeId = null
    closeRunStream()
    error = null

    if (!hasExisting) {
      loading = true
      loaded = false
    }

    currentSessionId = sessionId

    try {
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.messages({ params: { id: sessionId } }),
        'Failed to load messages'
      )

      if (currentSessionId !== sessionId) return

      if (!result.ok) throw new Error(result.error.message)

      const serverMessages: MessageNode[] = result.value as MessageNode[]
      if (!(hasExisting && serverMessages.length === 0)) {
        messages = serverMessages
      }
    } catch (e) {
      if (currentSessionId !== sessionId) return
      error = requestErrorMessage(e, 'Failed to load messages')
      if (!hasExisting) messages = []
    } finally {
      if (currentSessionId === sessionId) {
        loading = false
        loaded = true
      }
    }
  }

  function addOptimisticUserMessage(
    sessionId: string,
    input: string,
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
      encoded: { role: 'user', content: input },
      createdAt: now,
    }
    messages = [...messages, optimistic]
  }

  async function refreshMessages(
    sessionId: string,
    opts?: { clearPartsForRun?: string }
  ) {
    try {
      const client = await getApiClient(connectionsStore.getApiBase())
      const result = await runApi(
        client.sessions.messages({ params: { id: sessionId } }),
        'Failed to refresh messages'
      )
      if (!result.ok) {
        console.error('Failed to refresh messages', result.error)
        return
      }
      const fresh: MessageNode[] = result.value as MessageNode[]
      if (currentSessionId === sessionId) {
        messages = fresh
        if (opts?.clearPartsForRun && streamedRunId === opts.clearPartsForRun) {
          streamingParts = []
          resetCursor(opts.clearPartsForRun)
          streamedRunId = null
          streamedRunBaseNodeId = null
          closeRunStream()
        }
      }
    } catch (cause) {
      console.error('Failed to refresh messages', cause)
    }
  }

  sseStore.onEvent((event) => {
    if (
      event._tag === 'MessagesAppended' &&
      currentSessionId &&
      event.sessionId === currentSessionId
    ) {
      refreshMessages(event.sessionId)
    }
  })

  function clear() {
    closeRunStream()
    messages = []
    currentSessionId = null
    loading = false
    loaded = false
    error = null
    streamingParts = []
    resetCursor()
    streamedRunId = null
    streamedRunBaseNodeId = null
  }

  return {
    get messages() {
      return messages
    },
    get loading() {
      return loading
    },
    get loaded() {
      return loaded
    },
    get error() {
      return error
    },
    get currentSessionId() {
      return currentSessionId
    },
    get streamingParts() {
      return streamingParts
    },
    get activeRunId() {
      return streamedRunId
    },
    get activeRunBaseNodeId() {
      return streamedRunBaseNodeId
    },
    prepareSession,
    loadMessages,
    selectRunStream,
    addOptimisticUserMessage,
    clear,
  }
}

export const messagesStore = createMessagesStore()
