import { describe, expect, it } from 'vitest'
import { streamedSummarySections } from './background-child-presentation.js'

describe('background child presentation', () => {
  it('extracts summary prose without exposing the JSON envelope', () => {
    expect(
      streamedSummarySections(
        '{"summaries":[{"rangeIndex":0,"content":"First summary."},{"rangeIndex":1,"content":"Second\\nsummary with \\"detail\\"."}]}'
      )
    ).toEqual([
      { text: 'First summary.', complete: true },
      { text: 'Second\nsummary with "detail".', complete: true },
    ])
  })

  it('projects useful prose from an incomplete stream', () => {
    expect(
      streamedSummarySections(
        '{"summaries":[{"rangeIndex":0,"content":"The inspected files establish'
      )
    ).toEqual([{ text: 'The inspected files establish', complete: false }])
  })

  it('does not reinterpret ordinary child output', () => {
    expect(
      streamedSummarySections(
        'The compacted source records the requested exact fact.'
      )
    ).toEqual([])
  })
})
