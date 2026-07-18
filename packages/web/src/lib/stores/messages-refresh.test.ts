import { Deferred, Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageToolPreloader, MessagesApi } from '$lib/connection-services.js'
import type { MessageNode } from '$lib/types.js'
import type { ConversationSnapshot } from '@sorato/api'
import { messagesStore } from './messages.svelte.js'

interface ControlledMessagesApi {
  readonly layer: Layer.Layer<MessagesApi | MessageToolPreloader>
  readonly waitForRequestCount: (count: number) => Effect.Effect<void>
  readonly resolve: (
    index: number,
    snapshot: ConversationSnapshot
  ) => Effect.Effect<boolean>
}

const makeControlledMessagesApi = (): ControlledMessagesApi => {
  const requests: Array<Deferred.Deferred<ConversationSnapshot>> = []
  const requestWaiters: Array<{
    readonly count: number
    readonly deferred: Deferred.Deferred<void>
  }> = []

  const waitForRequestCount = (count: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (requests.length >= count) return Effect.void
      return Deferred.make<void>().pipe(
        Effect.tap((deferred) =>
          Effect.sync(() => {
            requestWaiters.push({ count, deferred })
          })
        ),
        Effect.flatMap(Deferred.await)
      )
    })

  const messagesLayer = Layer.succeed(
    MessagesApi,
    MessagesApi.of({
      list: () =>
        Deferred.make<ConversationSnapshot>().pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              requests.push(response)
            })
          ),
          Effect.tap(() =>
            Effect.forEach(
              requestWaiters.filter(
                (waiter) => requests.length >= waiter.count
              ),
              (waiter) => Deferred.succeed(waiter.deferred, undefined),
              { discard: true }
            )
          ),
          Effect.flatMap(Deferred.await)
        ),
    })
  )
  const preloaderLayer = Layer.succeed(
    MessageToolPreloader,
    MessageToolPreloader.of({
      preloadMessages: () => Effect.void,
      preloadTool: () => Effect.void,
    })
  )

  return {
    layer: Layer.merge(messagesLayer, preloaderLayer),
    waitForRequestCount,
    resolve: (index, snapshot) => {
      const request = requests[index]
      return request === undefined
        ? Effect.die(new Error(`Missing controlled request ${index}`))
        : Deferred.succeed(request, snapshot)
    },
  } satisfies ControlledMessagesApi
}

const userMessage = (
  id: string,
  sessionId: string,
  content: string
): MessageNode => ({
  id,
  sessionId,
  parentId: null,
  kind: 'message',
  messageId: id,
  summaryId: null,
  sourceNodeId: null,
  runId: null,
  run: null,
  modelCall: null,
  encoded: { role: 'user', content },
  createdAt: 0,
})

describe('messagesStore refresh ordering', () => {
  afterEach(() => {
    messagesStore.clearAll()
  })

  it('applies an intermediate response while a newer refresh is pending', async () => {
    const tabId = 'intermediate-refresh-tab'
    const sessionId = 'intermediate-refresh-session'
    const activePrompt = userMessage('active', sessionId, 'Active prompt')
    const queuedPrompt = userMessage('queued', sessionId, 'Queued prompt')
    const controlled = makeControlledMessagesApi()
    messagesStore.prepareSession(tabId, sessionId)

    const intermediateRefresh = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(1))
    const newestRefresh = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(2))

    await Effect.runPromise(
      controlled.resolve(0, { sequence: 1, nodes: [activePrompt] })
    )
    await intermediateRefresh
    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt'])

    await Effect.runPromise(
      controlled.resolve(1, {
        sequence: 2,
        nodes: [activePrompt, queuedPrompt],
      })
    )
    await newestRefresh
    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt', 'Queued prompt'])
  })

  it('keeps newer nodes when an older forced snapshot completes last', async () => {
    const tabId = 'queued-message-tab'
    const sessionId = 'queued-message-session'
    const activePrompt = userMessage('active', sessionId, 'Active prompt')
    const queuedPrompt = userMessage('queued', sessionId, 'Queued prompt')
    const controlled = makeControlledMessagesApi()
    messagesStore.prepareSession(tabId, sessionId)

    const runEndRefresh = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(1))
    const queuedMessageRefresh = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(2))

    await Effect.runPromise(
      controlled.resolve(1, {
        sequence: 2,
        nodes: [activePrompt, queuedPrompt],
      })
    )
    await queuedMessageRefresh
    await Effect.runPromise(
      controlled.resolve(0, { sequence: 1, nodes: [activePrompt] })
    )
    await runEndRefresh

    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt', 'Queued prompt'])
  })

  it('keeps a retained transcript visible during forced recovery', async () => {
    const tabId = 'retained-tab'
    const sessionId = 'retained-session'
    const retained = userMessage('retained', sessionId, 'Retained prompt')
    const controlled = makeControlledMessagesApi()
    messagesStore.prepareSession(tabId, sessionId)

    const initial = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(1))
    await Effect.runPromise(
      controlled.resolve(0, { sequence: 1, nodes: [retained] })
    )
    await initial

    const recovery = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(2))

    expect(messagesStore.loadingForTab(tabId)).toBe(false)
    expect(messagesStore.messagesForTab(tabId)).toEqual([retained])

    await Effect.runPromise(
      controlled.resolve(1, { sequence: 1, nodes: [retained] })
    )
    await recovery
  })

  it('does not add an optimistic node after its committed event won the race', async () => {
    const tabId = 'response-race-tab'
    const sessionId = 'response-race-session'
    const committed = {
      ...userMessage('committed', sessionId, 'Already committed'),
      runId: 'run-1',
    }
    const controlled = makeControlledMessagesApi()
    messagesStore.prepareSession(tabId, sessionId)

    const load = Effect.runPromise(
      messagesStore
        .loadMessages(tabId, sessionId, { force: true })
        .pipe(Effect.provide(controlled.layer))
    )
    await Effect.runPromise(controlled.waitForRequestCount(1))
    await Effect.runPromise(
      controlled.resolve(0, { sequence: 1, nodes: [committed] })
    )
    await load

    messagesStore.addOptimisticUserMessage(
      tabId,
      sessionId,
      'Already committed',
      [],
      null,
      'run-1'
    )

    expect(messagesStore.messagesForTab(tabId)).toEqual([committed])
  })
})
