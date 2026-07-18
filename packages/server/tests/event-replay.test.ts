import { describe, expect, it } from '@effect/vitest'
import {
  appendReplayEvent,
  endEventReplay,
  getReplayBufferSince,
  getContentThroughEventId,
  getReplayResetReason,
  getReplaySnapshot,
  resetEventReplay,
  startEventReplay,
} from '../src/event-replay.ts'

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
    expect(getContentThroughEventId('run-1')).toBe(1)
    appendReplayEvent('session-1', 'run-1', {
      _tag: 'ToolCall',
      sessionId: 'session-1',
      runId: 'run-1',
      id: 'tool-1',
      name: 'read',
      params: {},
    })
    expect(getContentThroughEventId('run-1')).toBe(2)

    expect(getReplaySnapshot('run-1')).toEqual({
      sessionId: 'session-1',
      runId: 'run-1',
      baseNodeId: null,
      kind: 'agent',
      visibility: 'primary',
      title: undefined,
      parentRunId: undefined,
      toolCallId: undefined,
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
    expect(getReplayBufferSince('run-1', undefined)).toEqual([
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
      getReplayBufferSince('run-1', { runId: 'run-1', eventId: 1 })
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
    expect(getContentThroughEventId('run-1')).toBeUndefined()
    expect(getReplayBufferSince('run-1', undefined)).toEqual([])
    expect(getReplayResetReason('run-1', { runId: 'run-1', eventId: 2 })).toBe(
      'run_completed'
    )
  })

  it('reports unavailable replay for cursors with no known run state', () => {
    resetEventReplay()

    expect(getReplayResetReason('run-1', { runId: 'run-1', eventId: 1 })).toBe(
      'replay_unavailable'
    )
  })

  it('treats cursors from older runs as a full replay of the requested active run', () => {
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
      getReplayBufferSince('run-2', { runId: 'run-1', eventId: 99 })
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
