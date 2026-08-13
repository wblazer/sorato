import { describe, expect, it } from 'vitest'
import { MessageRefreshOrder } from './message-refresh-order.ts'

describe('MessageRefreshOrder', () => {
  it('allows an intermediate response while a newer request is pending', () => {
    const order = new MessageRefreshOrder()
    const intermediateRefresh = order.begin()
    order.begin()
    let visibleMessages: ReadonlyArray<string> = []

    const committed = order.commitIfFresh(intermediateRefresh, () => {
      visibleMessages = ['intermediate response']
    })

    expect(committed).toBe(true)
    expect(visibleMessages).toEqual(['intermediate response'])
  })

  it('prevents an older response from overwriting a newer committed response', () => {
    const order = new MessageRefreshOrder()
    const runEndRefresh = order.begin()
    const queuedMessageRefresh = order.begin()
    let visibleMessages = ['active prompt']

    order.commitIfFresh(queuedMessageRefresh, () => {
      visibleMessages = ['active prompt', 'queued prompt']
    })
    const staleCommitted = order.commitIfFresh(runEndRefresh, () => {
      visibleMessages = ['active prompt']
    })

    expect(staleCommitted).toBe(false)
    expect(visibleMessages).toEqual(['active prompt', 'queued prompt'])
  })

  it('invalidates pending responses when the active session is cleared', () => {
    const order = new MessageRefreshOrder()
    const pendingRefresh = order.begin()
    order.clear()

    expect(order.commitIfFresh(pendingRefresh, () => undefined)).toBe(false)
  })

  it('invalidates pending responses when all state is cleared', () => {
    const order = new MessageRefreshOrder()
    const pendingRefresh = order.begin()
    order.clearAll()

    expect(order.commitIfFresh(pendingRefresh, () => undefined)).toBe(false)
  })
})
