import { describe, expect, it } from '@effect/vitest'
import { publish } from '../src/server/event-bus.ts'
import {
  getReplayBufferSince,
  resetEventReplay,
} from '../src/server/event-replay.ts'

describe('EventReplay', () => {
  it('buffers content events between RunStart and RunEnd', () => {
    resetEventReplay()

    publish({ _tag: 'RunStart', sessionId: 'session-1' })
    publish({
      _tag: 'TextDelta',
      sessionId: 'session-1',
      delta: 'hello',
      eventId: 1,
    })
    publish({
      _tag: 'ToolCall',
      sessionId: 'session-1',
      id: 'tool-1',
      name: 'read',
      params: {},
      eventId: 2,
    })

    expect(getReplayBufferSince('session-1', 0)).toEqual([
      {
        _tag: 'TextDelta',
        sessionId: 'session-1',
        delta: 'hello',
        eventId: 1,
      },
      {
        _tag: 'ToolCall',
        sessionId: 'session-1',
        id: 'tool-1',
        name: 'read',
        params: {},
        eventId: 2,
      },
    ])
    expect(getReplayBufferSince('session-1', 1)).toEqual([
      {
        _tag: 'ToolCall',
        sessionId: 'session-1',
        id: 'tool-1',
        name: 'read',
        params: {},
        eventId: 2,
      },
    ])

    publish({ _tag: 'RunEnd', sessionId: 'session-1' })
    expect(getReplayBufferSince('session-1', 0)).toEqual([])
  })
})
