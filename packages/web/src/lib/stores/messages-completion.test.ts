import {
  Effect,
  Layer,
  ManagedRuntime,
  Queue,
  Stream,
  type Queue as EffectQueue,
} from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ActiveConnection,
  AuthApi,
  DirectoriesApi,
  HandshakeApi,
  MessagesApi,
  MessageToolPreloader,
  ModelsApi,
  ProjectsApi,
  ServerEventSource,
  SessionsApi,
  type ConnectionServices,
} from '$lib/connection-services.js'
import {
  clearConnectionRuntime,
  installConnectionRuntime,
} from '$lib/connection-runtime.js'
import type { MessageNode, ServerEvent } from '$lib/types.js'
import { sseStore } from './sse.svelte.js'
import { messagesStore } from './messages.svelte.js'

const unused = () => Effect.die(new Error('Unexpected test service call'))

const makeRuntime = (
  globalEvents: EffectQueue.Queue<ServerEvent>,
  runEvents: EffectQueue.Queue<ServerEvent>
) => {
  const layer: Layer.Layer<ConnectionServices> = Layer.mergeAll(
    Layer.succeed(
      ActiveConnection,
      ActiveConnection.of({
        id: 'test',
        scopeId: 'test',
        baseUrl: 'http://localhost',
      })
    ),
    Layer.succeed(
      SessionsApi,
      SessionsApi.of({
        list: unused,
        get: unused,
        create: unused,
        run: unused,
        compactRange: unused,
        stopRun: unused,
      })
    ),
    Layer.succeed(
      MessagesApi,
      MessagesApi.of({
        list: () => Effect.succeed({ sequence: 0, nodes: [] }),
      })
    ),
    Layer.succeed(
      ProjectsApi,
      ProjectsApi.of({
        list: unused,
        create: unused,
        archive: unused,
        searchFiles: unused,
      })
    ),
    Layer.succeed(ModelsApi, ModelsApi.of({ list: unused })),
    Layer.succeed(
      AuthApi,
      AuthApi.of({
        status: unused,
        set: unused,
        oauthAuthorize: unused,
      })
    ),
    Layer.succeed(DirectoriesApi, DirectoriesApi.of({ list: unused })),
    Layer.succeed(HandshakeApi, HandshakeApi.of({ check: unused })),
    Layer.succeed(
      ServerEventSource,
      ServerEventSource.of({
        stream: (options) =>
          Stream.fromQueue(
            options?.runId === undefined ? globalEvents : runEvents
          ),
      })
    ),
    Layer.succeed(
      MessageToolPreloader,
      MessageToolPreloader.of({
        preloadMessages: () => Effect.void,
        preloadTool: () => Effect.void,
      })
    )
  )

  return ManagedRuntime.make(layer)
}

const assistantNode = (sessionId: string, runId: string): MessageNode => ({
  id: 'assistant-node',
  sessionId,
  parentId: null,
  kind: 'message',
  messageId: 'assistant-message',
  summaryId: null,
  sourceNodeId: null,
  runId,
  run: null,
  modelCall: null,
  encoded: { role: 'assistant', content: 'Final answer' },
  createdAt: 1,
})

describe('messagesStore run completion', () => {
  afterEach(async () => {
    sseStore.disconnect()
    messagesStore.clearAll()
    await clearConnectionRuntime('messages-completion-test')
  })

  it('keeps the committed assistant when the run stream ends first', async () => {
    const sessionId = 'session-1'
    const runId = 'run-1'
    const tabId = 'tab-1'
    const globalEvents = await Effect.runPromise(Queue.unbounded<ServerEvent>())
    const runEvents = await Effect.runPromise(Queue.unbounded<ServerEvent>())
    installConnectionRuntime(
      'messages-completion-test',
      makeRuntime(globalEvents, runEvents)
    )

    messagesStore.prepareSession(tabId, sessionId)
    messagesStore.selectRunStream(tabId, sessionId, runId)
    sseStore.connect()

    await Effect.runPromise(
      Queue.offer(runEvents, {
        _tag: 'TextDelta',
        sessionId,
        runId,
        delta: 'Final answer',
        eventId: 1,
      })
    )
    await vi.waitFor(() => {
      expect(messagesStore.streamingPartsForTab(tabId)).toEqual([
        { type: 'text', text: 'Final answer' },
      ])
    })

    const runEnd = {
      _tag: 'RunEnd' as const,
      sequence: 3,
      sessionId,
      runId,
    }
    await Effect.runPromise(Queue.offer(runEvents, runEnd))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const node = assistantNode(sessionId, runId)
    await Effect.runPromise(
      Queue.offer(globalEvents, {
        _tag: 'NodeBatchCommitted',
        sequence: 2,
        sessionId,
        runId,
        nodes: [node],
        headNodeId: node.id,
        sessionUpdatedAt: 1,
        contentThroughEventId: 1,
      })
    )
    await Effect.runPromise(Queue.offer(globalEvents, runEnd))

    await vi.waitFor(() => {
      expect(messagesStore.messagesForTab(tabId)).toEqual([node])
      expect(messagesStore.streamingPartsForTab(tabId)).toEqual([])
      expect(messagesStore.durableRunFocusForTab(tabId, runId)).toBe(node.id)
    })
  })
})
