import { Effect } from 'effect'
import type { Effect as EffectValue } from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageNode } from '$lib/types.js'

const controlledApi = vi.hoisted(() => ({
  responses: [] as Array<Promise<ReadonlyArray<MessageNode>>>,
}))

vi.mock('$lib/api-client.js', () => ({
  apiClient: () =>
    Effect.succeed({
      sessions: {
        messages: () =>
          Effect.promise(() => {
            const response = controlledApi.responses.shift()
            if (response === undefined) {
              return Promise.reject(new Error('Missing controlled response'))
            }
            return response
          }),
      },
    }),
  runApiEffect: <A, E, R>(effect: EffectValue<A, E, R>) => effect,
}))

vi.mock('$lib/tool-output.js', () => ({
  preloadMessageToolDiffs: () => Promise.resolve(),
  preloadToolDiff: () => Promise.resolve(),
}))

// oxlint-disable-next-line sorato/no-dynamic-import -- the store must load after Vitest installs its API and tool-output mocks
const { messagesStore } = await import('./messages.svelte.js')

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

const controlledResponse = () => {
  let resolve!: (messages: ReadonlyArray<MessageNode>) => void
  const promise = new Promise<ReadonlyArray<MessageNode>>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const waitForRequestStart = (remainingResponses: number) =>
  vi.waitFor(() => {
    expect(controlledApi.responses).toHaveLength(remainingResponses)
  })

describe('messagesStore refresh ordering', () => {
  afterEach(() => {
    controlledApi.responses = []
    messagesStore.clearAll()
  })

  it('applies an intermediate response while a newer refresh is pending', async () => {
    const tabId = 'intermediate-refresh-tab'
    const sessionId = 'intermediate-refresh-session'
    const activePrompt = userMessage('active', sessionId, 'Active prompt')
    const queuedPrompt = userMessage('queued', sessionId, 'Queued prompt')
    const intermediate = controlledResponse()
    const newest = controlledResponse()
    controlledApi.responses.push(intermediate.promise, newest.promise)
    messagesStore.prepareSession(tabId, sessionId)

    const intermediateRefresh = Effect.runPromise(
      messagesStore.loadMessages(tabId, sessionId, { force: true })
    )
    await waitForRequestStart(1)
    const newestRefresh = Effect.runPromise(
      messagesStore.loadMessages(tabId, sessionId, { force: true })
    )
    await waitForRequestStart(0)

    intermediate.resolve([activePrompt])
    await intermediateRefresh
    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt'])

    newest.resolve([activePrompt, queuedPrompt])
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
    const staleRunEnd = controlledResponse()
    const freshQueuedMessage = controlledResponse()
    controlledApi.responses.push(
      staleRunEnd.promise,
      freshQueuedMessage.promise
    )
    messagesStore.prepareSession(tabId, sessionId)

    const runEndRefresh = Effect.runPromise(
      messagesStore.loadMessages(tabId, sessionId, { force: true })
    )
    await waitForRequestStart(1)
    const queuedMessageRefresh = Effect.runPromise(
      messagesStore.loadMessages(tabId, sessionId, { force: true })
    )
    await waitForRequestStart(0)

    freshQueuedMessage.resolve([activePrompt, queuedPrompt])
    await queuedMessageRefresh
    staleRunEnd.resolve([activePrompt])
    await runEndRefresh

    expect(
      messagesStore
        .messagesForTab(tabId)
        .map((message) => message.encoded.content)
    ).toEqual(['Active prompt', 'Queued prompt'])
  })
})
