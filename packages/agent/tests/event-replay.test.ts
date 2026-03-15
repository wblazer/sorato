import { describe, expect, it } from '@effect/vitest'
import {
  appendReplayEvent,
  endEventReplay,
  getReplayBufferSince,
  getReplaySnapshot,
  resetEventReplay,
  startEventReplay,
} from '../src/server/event-replay.ts'

describe('EventReplay', () => {
  it('buffers content events for the active run', () => {
    resetEventReplay()

    startEventReplay('session-1', 'run-1')

    appendReplayEvent('session-1', 'run-1', {
      _tag: 'TextDelta',
      sessionId: 'session-1',
      runId: 'run-1',
      delta: 'hello',
    })
    appendReplayEvent('session-1', 'run-1', {
      _tag: 'ToolCall',
      sessionId: 'session-1',
      runId: 'run-1',
      id: 'tool-1',
      name: 'read',
      params: {},
    })

    expect(getReplaySnapshot('session-1')).toEqual({
      runId: 'run-1',
      events: [
        {
          _tag: 'TextDelta',
          sessionId: 'session-1',
          runId: 'run-1',
          delta: 'hello',
          eventId: 1,
        },
        {
          _tag: 'ToolCall',
          sessionId: 'session-1',
          runId: 'run-1',
          id: 'tool-1',
          name: 'read',
          params: {},
          eventId: 2,
        },
      ],
    })
    expect(getReplayBufferSince('session-1', null)).toEqual([
      {
        _tag: 'TextDelta',
        sessionId: 'session-1',
        runId: 'run-1',
        delta: 'hello',
        eventId: 1,
      },
      {
        _tag: 'ToolCall',
        sessionId: 'session-1',
        runId: 'run-1',
        id: 'tool-1',
        name: 'read',
        params: {},
        eventId: 2,
      },
    ])
    expect(
      getReplayBufferSince('session-1', { runId: 'run-1', eventId: 1 })
    ).toEqual([
      {
        _tag: 'ToolCall',
        sessionId: 'session-1',
        runId: 'run-1',
        id: 'tool-1',
        name: 'read',
        params: {},
        eventId: 2,
      },
    ])

    endEventReplay('session-1', 'run-1')
    expect(getReplayBufferSince('session-1', null)).toEqual([])
  })

  it('treats cursors from older runs as a full replay of the active run', () => {
    resetEventReplay()

    startEventReplay('session-1', 'run-1')
    appendReplayEvent('session-1', 'run-1', {
      _tag: 'TextDelta',
      sessionId: 'session-1',
      runId: 'run-1',
      delta: 'old',
    })
    endEventReplay('session-1', 'run-1')

    startEventReplay('session-1', 'run-2')
    appendReplayEvent('session-1', 'run-2', {
      _tag: 'TextDelta',
      sessionId: 'session-1',
      runId: 'run-2',
      delta: 'new',
    })

    expect(
      getReplayBufferSince('session-1', { runId: 'run-1', eventId: 99 })
    ).toEqual([
      {
        _tag: 'TextDelta',
        sessionId: 'session-1',
        runId: 'run-2',
        delta: 'new',
        eventId: 1,
      },
    ])
  })
})
