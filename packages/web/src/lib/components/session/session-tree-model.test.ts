import { describe, expect, it } from 'vitest'
import type { SelectedHead } from '$lib/selected-head-storage.js'
import type { ActiveRunSummary, MessageNode } from '$lib/types.js'
import {
  buildSessionTreeModel,
  compactRangeForHead,
  headForSessionTreeItem,
  itemIdForHead,
  pathItemIdsForHead,
} from './session-tree-model.js'

const assistant = (
  id: string,
  parentId: string | null,
  runId: string,
  content: MessageNode['encoded']['content'] = id
): MessageNode => ({
  id,
  sessionId: 'session',
  parentId,
  kind: 'message',
  messageId: `message:${id}`,
  summaryId: null,
  sourceNodeId: null,
  runId,
  run: null,
  modelCall: null,
  encoded: { role: 'assistant', content },
  createdAt: 0,
})

const activeRun = (
  runId: string,
  baseNodeId: string | null
): ActiveRunSummary => ({
  sessionId: 'session',
  runId,
  baseNodeId,
  kind: 'agent',
  visibility: 'primary',
})

const toolResult = (
  id: string,
  parentId: string,
  runId: string,
  toolCallId: string
): MessageNode => ({
  id,
  sessionId: 'session',
  parentId,
  kind: 'message',
  messageId: `message:${id}`,
  summaryId: null,
  sourceNodeId: null,
  runId,
  run: null,
  modelCall: null,
  encoded: {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        id: toolCallId,
        name: 'read',
        isFailure: false,
        result: 'result',
      },
    ],
  },
  createdAt: 0,
})

const nodeItem = (
  model: ReturnType<typeof buildSessionTreeModel>,
  id: string
) => {
  const item = model.itemById.get(id)
  expect(item?.type).toBe('node-group')
  if (!item || item.type !== 'node-group') throw new Error(`Missing ${id}`)
  return item
}

describe('buildSessionTreeModel', () => {
  it('groups a linear sequence of agent steps', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('a', null, 'original'),
        assistant('b', 'a', 'original'),
        assistant('c', 'b', 'original'),
      ],
      activeRuns: [],
      groupAgentSteps: true,
    })

    expect(model.roots.map((item) => item.id)).toEqual(['node:a'])
    expect(nodeItem(model, 'node:a').nodeIds).toEqual(['a', 'b', 'c'])
  })

  it('ends a group at an interior node with an attached run', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('a', null, 'original'),
        assistant('b', 'a', 'original'),
        assistant('c', 'b', 'original'),
      ],
      activeRuns: [activeRun('fork', 'b')],
      groupAgentSteps: true,
    })

    const group = nodeItem(model, 'node:a')
    expect(group.nodeIds).toEqual(['a', 'b'])
    expect(group.children.map((item) => item.id)).toEqual([
      'node:c',
      'run:fork',
    ])
    expect(model.ownerByNodeId.get('b')).toBe('node:a')
  })

  it('ends a group where the persisted node graph branches', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('a', null, 'original'),
        assistant('b', 'a', 'original'),
        assistant('c', 'b', 'original'),
        assistant('d', 'b', 'other'),
      ],
      activeRuns: [],
      groupAgentSteps: true,
    })

    const group = nodeItem(model, 'node:a')
    expect(group.nodeIds).toEqual(['a', 'b'])
    expect(group.children.map((item) => item.id)).toEqual(['node:c', 'node:d'])
  })

  it('maps an interior selected node to its group without changing the head', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('a', null, 'original'),
        assistant('b', 'a', 'original'),
      ],
      activeRuns: [],
      groupAgentSteps: true,
    })
    const selected: SelectedHead = { type: 'node', nodeId: 'a' }

    expect(itemIdForHead(model, selected)).toBe('node:a')
    expect(pathItemIdsForHead(model, selected)).toEqual(new Set(['node:a']))
    expect(headForSessionTreeItem(nodeItem(model, 'node:a'))).toEqual({
      type: 'node',
      nodeId: 'b',
    })
  })

  it('exposes the complete grouped range for compaction', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('a', null, 'original'),
        assistant('b', 'a', 'original'),
      ],
      activeRuns: [],
      groupAgentSteps: true,
    })

    expect(nodeItem(model, 'node:a').compactRange).toEqual({
      startNodeId: 'a',
      endNodeId: 'b',
    })
  })

  it('clips compaction to an interior selected head', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('a', null, 'original'),
        assistant('b', 'a', 'original'),
        assistant('c', 'b', 'original'),
      ],
      activeRuns: [],
      groupAgentSteps: true,
    })

    expect(
      compactRangeForHead(model, 'node:a', { type: 'node', nodeId: 'b' })
    ).toEqual({ startNodeId: 'a', endNodeId: 'b' })
  })

  it('allows selecting a persisted assistant call with no tool result', () => {
    const call = assistant('call', null, 'original', [
      { type: 'tool-call', id: 'tool', name: 'read', params: {} },
    ])
    const model = buildSessionTreeModel({
      messages: [call],
      activeRuns: [],
      groupAgentSteps: true,
    })
    const item = nodeItem(model, 'node:call')

    expect(item.unresolvedToolCallCount).toBe(1)
    expect(headForSessionTreeItem(item)).toEqual({
      type: 'node',
      nodeId: 'call',
    })
  })

  it('treats a run with a null base as a normal root run', () => {
    const model = buildSessionTreeModel({
      messages: [],
      activeRuns: [activeRun('root', null)],
      groupAgentSteps: true,
    })

    expect(model.roots.map((item) => item.id)).toEqual(['run:root'])
    expect(model.itemById.get('run:root')).toMatchObject({
      attachment: { type: 'root' },
    })
    expect(model.diagnostics).toEqual([])
  })

  it('keeps a run with a missing non-null anchor visible and diagnosed', () => {
    const model = buildSessionTreeModel({
      messages: [],
      activeRuns: [activeRun('orphan', 'missing')],
      groupAgentSteps: true,
    })

    expect(model.roots.map((item) => item.id)).toEqual(['run:orphan'])
    expect(model.itemById.get('run:orphan')).toMatchObject({
      attachment: { type: 'unresolved', nodeId: 'missing' },
    })
    expect(model.diagnostics).toEqual([
      {
        type: 'missing-run-anchor',
        runId: 'orphan',
        nodeId: 'missing',
      },
    ])
  })

  it('uses the semantic run anchor when active nodes exist on two branches', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('old-parent', null, 'old'),
        assistant('old-output', 'old-parent', 'active'),
        assistant('new-parent', null, 'summary'),
        assistant('new-output', 'new-parent', 'active'),
      ],
      activeRuns: [activeRun('active', 'new-parent')],
      groupAgentSteps: true,
    })

    expect(model.parentByItemId.get('run:active')).toBe('node:new-parent')
    expect(model.ownerByNodeId.get('old-output')).toBe('node:old-output')
    expect(model.ownerByNodeId.get('new-output')).toBe('run:active')
  })

  it('attaches above a rebased node hidden by the same active run', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('summary', null, 'summary-run'),
        assistant('cloned-output', 'summary', 'active'),
      ],
      activeRuns: [activeRun('active', 'cloned-output')],
      groupAgentSteps: true,
    })

    expect(model.parentByItemId.get('run:active')).toBe('node:summary')
    expect(model.itemById.get('run:active')).toMatchObject({
      attachment: { type: 'attached', parentItemId: 'node:summary' },
    })
  })

  it('shows persisted active steps when agent grouping is disabled', () => {
    const model = buildSessionTreeModel({
      messages: [
        assistant('base', null, 'old'),
        assistant('output', 'base', 'active'),
      ],
      activeRuns: [activeRun('active', 'base')],
      groupAgentSteps: false,
    })

    expect(model.ownerByNodeId.get('output')).toBe('node:output')
    expect(model.parentByItemId.get('run:active')).toBe('node:output')
  })

  it('still groups a complete tool exchange when agent grouping is disabled', () => {
    const call = assistant('call', null, 'original', [
      { type: 'tool-call', id: 'tool', name: 'read', params: {} },
    ])
    const model = buildSessionTreeModel({
      messages: [call, toolResult('result', 'call', 'original', 'tool')],
      activeRuns: [],
      groupAgentSteps: false,
    })

    expect(nodeItem(model, 'node:call').nodeIds).toEqual(['call', 'result'])
  })
})
