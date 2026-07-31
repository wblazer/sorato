import { describe, expect, it } from 'vitest'
import { applyContentEvent } from './events.ts'

describe('applyContentEvent', () => {
  it('coalesces text deltas and preserves distinct tool activity', () => {
    const first = applyContentEvent([], {
      _tag: 'TextDelta',
      sessionId: 's',
      runId: 'r',
      delta: 'a',
      eventId: 1,
    })
    const second = applyContentEvent(first, {
      _tag: 'TextDelta',
      sessionId: 's',
      runId: 'r',
      delta: 'b',
      eventId: 2,
    })
    const tools = applyContentEvent(second, {
      _tag: 'ToolResult',
      sessionId: 's',
      runId: 'r',
      id: 't',
      name: 'shell',
      result: 'failed',
      isFailure: true,
      eventId: 3,
    })
    expect(tools).toHaveLength(2)
    expect(tools[0]?.body).toBe('ab')
    expect(tools[1]?.failed).toBe(true)
  })
})
