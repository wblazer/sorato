import { describe, expect, it } from 'vitest'
import type { ServerEvent } from '$lib/types.js'
import { acceptDurableEvent } from './durable-events.js'

const runEnd = (sequence: number): ServerEvent => ({
  _tag: 'RunEnd',
  sequence,
  sessionId: 'session-1',
  runId: 'run-1',
})

const titleUpdated = (sequence: number): ServerEvent => ({
  _tag: 'SessionTitleUpdated',
  sequence,
  sessionId: 'session-1',
  title: 'Updated title',
  updatedAt: 10,
})

const activeRunUpserted = (sequence: number): ServerEvent => ({
  _tag: 'ActiveRunUpserted',
  sequence,
  sessionId: 'session-1',
  runId: 'run-1',
  baseNodeId: 'base-1',
  kind: 'agent',
  visibility: 'primary',
})

describe('durable event acceptance', () => {
  it('advances one cursor across active run, end, and title variants', () => {
    const afterUpsert = acceptDurableEvent(3, activeRunUpserted(4))
    const afterRun = acceptDurableEvent(afterUpsert.lastSequence, runEnd(5))
    const afterTitle = acceptDurableEvent(
      afterRun.lastSequence,
      titleUpdated(6)
    )

    expect(afterUpsert).toEqual({ accepted: true, lastSequence: 4 })
    expect(afterRun).toEqual({ accepted: true, lastSequence: 5 })
    expect(afterTitle).toEqual({ accepted: true, lastSequence: 6 })
  })

  it('rejects duplicate and older durable lifecycle events', () => {
    expect(acceptDurableEvent(6, runEnd(6))).toEqual({
      accepted: false,
      lastSequence: 6,
    })
    expect(acceptDurableEvent(6, titleUpdated(5))).toEqual({
      accepted: false,
      lastSequence: 6,
    })
    expect(acceptDurableEvent(6, activeRunUpserted(4))).toEqual({
      accepted: false,
      lastSequence: 6,
    })
  })
})
