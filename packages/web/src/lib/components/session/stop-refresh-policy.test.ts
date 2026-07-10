import { Effect, Layer } from 'effect'
import { MessageToolPreloader, MessagesApi } from '$lib/connection-services.js'
import { describe, expect, it } from 'vitest'
import { refreshMessagesAfterStop } from './stop-refresh-policy.js'

const messageServices = Layer.merge(
  Layer.succeed(
    MessagesApi,
    MessagesApi.of({ list: () => Effect.succeed([]) })
  ),
  Layer.succeed(
    MessageToolPreloader,
    MessageToolPreloader.of({
      preloadMessages: () => Effect.void,
      preloadTool: () => Effect.void,
    })
  )
)
describe('refreshMessagesAfterStop', () => {
  it('refreshes persisted messages even when stop has no focus node', async () => {
    let refreshes = 0

    const focusNodeId = await Effect.runPromise(
      refreshMessagesAfterStop(
        {
          run: Effect.sync(() => {
            refreshes++
          }),
        },
        undefined
      ).pipe(Effect.provide(messageServices))
    )

    expect(refreshes).toBe(1)
    expect(focusNodeId).toBeUndefined()
  })

  it('preserves the queued focus node after refreshing messages', async () => {
    const focusNodeId = await Effect.runPromise(
      refreshMessagesAfterStop({ run: Effect.void }, 'queued-node').pipe(
        Effect.provide(messageServices)
      )
    )

    expect(focusNodeId).toBe('queued-node')
  })
})
