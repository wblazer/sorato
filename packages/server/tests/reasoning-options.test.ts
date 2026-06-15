/**
 * Unit tests for deriving thinking levels + provider requests purely from
 * models.dev `reasoningOptions` — no model-id heuristics.
 */
import { describe, expect, it } from '@effect/vitest'
import {
  type ReasoningOption,
  resolveReasoning,
  thinkingLevelsFor,
} from '../src/reasoning-options.ts'

const effort = (...values: Array<string>): ReasoningOption => ({
  type: 'effort',
  values,
})
const budget = (min: number, max?: number): ReasoningOption => ({
  type: 'budget',
  min,
  ...(max !== undefined ? { max } : {}),
})

describe('thinkingLevelsFor', () => {
  it('non-reasoning models offer only off', () => {
    expect(thinkingLevelsFor([], false)).toEqual(['off'])
  })

  it('effort enum surfaces exactly its values, xhigh included', () => {
    expect(
      thinkingLevelsFor([effort('medium', 'high', 'xhigh')], true)
    ).toEqual(['medium', 'high', 'xhigh'])
  })

  it('does not invent minimal/off for effort models that lack them', () => {
    expect(thinkingLevelsFor([effort('low', 'medium', 'high')], true)).toEqual([
      'low',
      'medium',
      'high',
    ])
  })

  it('maps effort none to off and sorts off first', () => {
    expect(
      thinkingLevelsFor(
        [effort('none', 'low', 'medium', 'high', 'xhigh')],
        true
      )
    ).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
  })

  it('carries anthropic max', () => {
    expect(
      thinkingLevelsFor([effort('low', 'medium', 'high', 'xhigh', 'max')], true)
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('budget-only models become a named ladder with off', () => {
    expect(thinkingLevelsFor([budget(1024)], true)).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
    ])
  })

  it('budget min/max filters the ladder', () => {
    expect(thinkingLevelsFor([budget(4096, 10000)], true)).toEqual([
      'off',
      'medium',
    ])
  })

  it('dual effort+budget models expose off plus the efforts', () => {
    expect(
      thinkingLevelsFor([effort('low', 'medium', 'high'), budget(1024)], true)
    ).toEqual(['off', 'low', 'medium', 'high'])
  })

  it('toggle models become an on/off select', () => {
    expect(thinkingLevelsFor([{ type: 'toggle' }], true)).toEqual(['off', 'on'])
  })
})

describe('resolveReasoning', () => {
  it('passes the selected effort straight through, no clamping', () => {
    expect(
      resolveReasoning([effort('medium', 'high', 'xhigh')], 'xhigh')
    ).toEqual({ kind: 'effort', effort: 'xhigh' })
    expect(
      resolveReasoning([effort('low', 'medium', 'high', 'xhigh', 'max')], 'max')
    ).toEqual({ kind: 'effort', effort: 'max' })
  })

  it('off sends explicit none effort when the model supports it', () => {
    expect(resolveReasoning([effort('none', 'low', 'high')], 'off')).toEqual({
      kind: 'effort',
      effort: 'none',
    })
  })

  it('off disables (none) when there is no none effort', () => {
    expect(resolveReasoning([effort('low', 'high')], 'off')).toEqual({
      kind: 'none',
    })
  })

  it('budget models resolve a ladder level to a token budget', () => {
    expect(resolveReasoning([budget(1024)], 'high')).toEqual({
      kind: 'budget',
      budgetTokens: 16384,
    })
  })

  it('dual models prefer effort for on-levels', () => {
    expect(
      resolveReasoning(
        [effort('low', 'medium', 'high'), budget(1024)],
        'medium'
      )
    ).toEqual({ kind: 'effort', effort: 'medium' })
  })

  it('undefined selection disables reasoning', () => {
    expect(resolveReasoning([effort('low', 'high')], undefined)).toEqual({
      kind: 'none',
    })
  })
})
