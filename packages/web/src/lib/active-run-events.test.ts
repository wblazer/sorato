import { describe, expect, it } from 'vitest'
import type { ActiveRunSummary, ServerEvent } from '$lib/types.js'
import {
  activeRunFromUpserted,
  removeActiveRun,
  sessionHasRunWork,
  upsertActiveRun,
} from './active-run-events.js'

const run = (baseNodeId: string | null): ActiveRunSummary => ({
  sessionId: 'session-1',
  runId: 'run-1',
  baseNodeId,
  kind: 'summary',
  visibility: 'background',
  title: 'Compact conversation',
  parentRunId: 'parent-run',
  toolCallId: 'tool-call',
})

describe('active run lifecycle', () => {
  it('preserves every active run summary field from the durable event', () => {
    const event: Extract<ServerEvent, { readonly _tag: 'ActiveRunUpserted' }> =
      {
        _tag: 'ActiveRunUpserted',
        sequence: 1,
        ...run('base-1'),
      }

    expect(activeRunFromUpserted(event)).toEqual(run('base-1'))
  })

  it('inserts a complete run and performs start cleanup once', () => {
    const result = upsertActiveRun(
      {
        activeRuns: new Map(),
        pendingRunStarts: new Map([['session-1', 2]]),
        queuedMessages: new Map([
          [
            'session-1',
            [
              { runId: 'run-1', content: 'started' },
              { runId: 'run-2', content: 'queued' },
            ],
          ],
        ]),
      },
      run('base-1')
    )

    expect(result.inserted).toBe(true)
    expect(result.activeRuns.get('run-1')).toEqual(run('base-1'))
    expect(result.pendingRunStarts.get('session-1')).toBe(1)
    expect(result.queuedMessages.get('session-1')).toEqual([
      { runId: 'run-2', content: 'queued' },
    ])
  })

  it('updates an existing run without consuming another pending start', () => {
    const result = upsertActiveRun(
      {
        activeRuns: new Map([['run-1', run('base-1')]]),
        pendingRunStarts: new Map([['session-1', 1]]),
        queuedMessages: new Map(),
      },
      run('base-2')
    )

    expect(result.inserted).toBe(false)
    expect(result.activeRuns.get('run-1')?.baseNodeId).toBe('base-2')
    expect(result.pendingRunStarts.get('session-1')).toBe(1)
  })

  it('converges after replayed upsert followed by end', () => {
    const upserted = upsertActiveRun(
      {
        activeRuns: new Map(),
        pendingRunStarts: new Map(),
        queuedMessages: new Map(),
      },
      run('base-2')
    )
    const activeRuns = removeActiveRun(upserted.activeRuns, 'run-1')

    expect(activeRuns.size).toBe(0)
    expect(sessionHasRunWork({ ...upserted, activeRuns }, 'session-1')).toBe(
      false
    )
  })
})
