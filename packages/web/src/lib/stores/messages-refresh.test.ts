import { Deferred, Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageToolPreloader, MessagesApi } from '$lib/connection-services.js'
import type { MessageNode } from '$lib/types.js'
import { messagesStore } from './messages.svelte.js'

interface ControlledMessagesApi {
  readonly layer: Layer.Layer<MessagesApi | MessageToolPreloader>
  readonly waitForRequestCount: (count: number) => Effect.Effect<void>
  readonly resolve: (
    index: number,
    messages: ReadonlyArray<MessageNode>
  ) => Effect.Effect<boolean>
}

const makeControlledMessagesApi = (): ControlledMessagesApi => {
  const requests: Array<Deferred.Deferred<ReadonlyArray<MessageNode>>> = []
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
        Deferred.make<ReadonlyArray<MessageNode>>().pipe(
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
    resolve: (index, messages) => {
      const request = requests[index]
      return request === undefined
        ? Effect.die(new Error(`Missing controlled request ${index}`))
        : Deferred.succeed(request, messages)
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

    await Effect.runPromise(controlled.resolve(0, [activePrompt]))
    await intermediateRefresh
    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt'])

    await Effect.runPromise(controlled.resolve(1, [activePrompt, queuedPrompt]))
    await newestRefresh
    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt', 'Queued prompt'])
  })

  it('keeps a queued message when an earlier RunEnd refresh completes last', async () => {
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

    await Effect.runPromise(controlled.resolve(1, [activePrompt, queuedPrompt]))
    await queuedMessageRefresh
    await Effect.runPromise(controlled.resolve(0, [activePrompt]))
    await runEndRefresh

    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt', 'Queued prompt'])
  })
})
