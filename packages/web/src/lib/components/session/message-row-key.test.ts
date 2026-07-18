import { describe, expect, it } from 'vitest'
import type { MessageNode } from '$lib/types.js'
import { assistantToolGroupKey, runSegmentKey } from './message-row-key.js'

const assistantNode = (id: string, runId: string): MessageNode => ({
  id,
  sessionId: 'session-1',
  parentId: null,
  kind: 'message',
  messageId: id,
  summaryId: null,
  sourceNodeId: null,
  runId,
  run: null,
  modelCall: null,
  encoded: { role: 'assistant', content: [] },
  createdAt: 0,
})

describe('message row keys', () => {
  it('keeps the first run segment key stable as nodes are appended', () => {
    const first = assistantNode('assistant-1', 'run-1')
    const appended = assistantNode('tool-1', 'run-1')
    const initialGroup = [first]
    const expandedGroup = [first, appended]

    expect(assistantToolGroupKey(initialGroup[0], 0)).toBe(
      runSegmentKey('run-1', 0)
    )
    expect(assistantToolGroupKey(expandedGroup[0], 0)).toBe(
      assistantToolGroupKey(initialGroup[0], 0)
    )
  })

  it('uses deterministic distinct keys for separated run segments', () => {
    const first = assistantNode('assistant-1', 'run-1')
    const second = assistantNode('assistant-2', 'run-1')

    expect(assistantToolGroupKey(first, 0)).toBe('run:run-1:segment:0')
    expect(assistantToolGroupKey(second, 1)).toBe('run:run-1:segment:1')
  })
})
