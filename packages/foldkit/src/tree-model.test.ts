import { MessageNodeResponse } from '@sorato/api'
import { describe, expect, it } from 'vitest'
import {
  buildTreeModel,
  flattenTree,
  isNodeInRange,
  selectedPathIds,
} from './tree-model.ts'

const node = (
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant' | 'tool' = 'assistant',
  runId: string | null = null,
  kind: 'message' | 'summary' = 'message'
) =>
  MessageNodeResponse.make({
    id,
    sessionId: 'session',
    parentId,
    kind,
    messageId: kind === 'message' ? id : null,
    summaryId: kind === 'summary' ? id : null,
    sourceNodeId: null,
    runId,
    run: null,
    modelCall: null,
    encoded:
      role === 'tool'
        ? { role: 'tool', content: [] }
        : role === 'user'
          ? { role: 'user', content: id }
          : { role: 'assistant', content: id },
    createdAt: 1,
  })

describe('conversation tree model', () => {
  it('preserves branches, sibling order, and selected ancestry without index depth', () => {
    const model = buildTreeModel([
      node('root', null, 'user'),
      node('left', 'root'),
      node('right', 'root'),
      node('leaf', 'right'),
    ])
    expect(model.roots[0]?.children.map((child) => child.nodeIds[0])).toEqual([
      'left',
      'right',
    ])
    expect([...selectedPathIds(model, 'leaf')]).toEqual([
      'node:leaf',
      'node:right',
      'node:root',
    ])
    const rows = flattenTree(model, 'leaf')
    expect(rows.map((row) => [row.item.nodeIds[0], row.depth])).toEqual([
      ['root', 0],
      ['right', 1],
      ['leaf', 1],
      ['left', 1],
    ])
    expect(rows.find((row) => row.item.nodeIds[0] === 'leaf')?.selected).toBe(
      true
    )
  })

  it('groups linear agent/tool runs, preserves summary tone, and computes range membership', () => {
    const model = buildTreeModel([
      node('prompt', null, 'user'),
      node('assistant', 'prompt', 'assistant', 'run'),
      node('tool', 'assistant', 'tool', 'run'),
      node('summary', 'tool', 'assistant', null, 'summary'),
    ])
    const agent = model.itemById.get('node:assistant')
    expect(agent?.nodeIds).toEqual(['assistant', 'tool'])
    expect(agent?.combinedRun).toBe(true)
    expect(model.itemById.get('node:summary')?.tone).toBe('summary')
    expect(isNodeInRange(['a', 'b', 'c'], 'c', 'a', 'b')).toBe(true)
    expect(isNodeInRange(['a', 'b', 'c'], 'a', 'b', 'c')).toBe(false)
  })
})
