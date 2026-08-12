import { describe, expect, it } from 'vitest'
import type { MessagePart } from '$lib/types.js'
import { currentPlan, planProgress } from './plan-presentation.js'

const call = (
  id: string,
  plan: ReadonlyArray<{
    readonly step: string
    readonly status: 'pending' | 'in_progress' | 'completed'
  }>
): MessagePart => ({
  type: 'tool-call',
  id,
  name: 'update_plan',
  params: { plan },
})

const result = (id: string, isFailure = false): MessagePart => ({
  type: 'tool-result',
  id,
  name: 'update_plan',
  isFailure,
  result: isFailure ? 'Plan rejected' : 'Plan updated',
})

describe('plan presentation', () => {
  it('derives the latest successful plan from the selected branch', () => {
    const first = call('first', [
      { step: 'Inspect', status: 'in_progress' },
      { step: 'Report', status: 'pending' },
    ])
    const second = call('second', [
      { step: 'Inspect', status: 'completed' },
      { step: 'Report', status: 'in_progress' },
    ])

    expect(
      currentPlan([first, result('first'), second, result('second')], [])
    ).toMatchObject({
      plan: [
        { step: 'Inspect', status: 'completed' },
        { step: 'Report', status: 'in_progress' },
      ],
    })
  })

  it('shows a streaming update without replacing a successful plan on failure', () => {
    const persisted = [
      call('persisted', [{ step: 'Inspect', status: 'in_progress' }]),
      result('persisted'),
    ]
    const streaming = call('streaming', [
      { step: 'Inspect', status: 'completed' },
      { step: 'Report', status: 'in_progress' },
    ])

    expect(currentPlan(persisted, [streaming])?.plan).toHaveLength(2)
    expect(
      currentPlan(persisted, [streaming, result('streaming', true)])?.plan
    ).toEqual([{ step: 'Inspect', status: 'in_progress' }])
  })

  it('selects the active label and counts explicit statuses', () => {
    expect(
      planProgress({
        explanation: undefined,
        plan: [
          { step: 'First', status: 'completed' },
          { step: 'Second', status: 'in_progress' },
          { step: 'Third', status: 'pending' },
        ],
      })
    ).toEqual({
      completed: 1,
      total: 3,
      activeStep: { step: 'Second', status: 'in_progress' },
      complete: false,
    })
  })
})
