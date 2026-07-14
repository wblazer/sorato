import { describe, expect, it } from 'vitest'
import type { ActiveRunSummary } from '$lib/types.js'
import { activeRunForHead } from './composer-run-control.js'

const run = (runId: string): ActiveRunSummary => ({
  sessionId: 'session',
  runId,
  baseNodeId: null,
  kind: 'agent',
  visibility: 'primary',
})

describe('activeRunForHead', () => {
  it('does not expose a session run while viewing a node', () => {
    expect(
      activeRunForHead({ type: 'node', nodeId: 'node' }, [run('active')])
    ).toBeNull()
  })

  it('does not expose a different active run', () => {
    expect(
      activeRunForHead({ type: 'run', runId: 'inactive', baseNodeId: null }, [
        run('active'),
      ])
    ).toBeNull()
  })

  it('returns the exact viewed run regardless of active-run order', () => {
    const first = run('first')
    const viewed = run('viewed')

    expect(
      activeRunForHead({ type: 'run', runId: 'viewed', baseNodeId: null }, [
        first,
        viewed,
      ])
    ).toBe(viewed)
  })
})
