import { describe, expect, it } from 'vitest'
import type { ContentEvent } from '@sorato/api'
import type { MessageNode } from '$lib/types.js'
import {
  acknowledgeContentThrough,
  appendContentEvent,
  applyConversationSnapshot,
  applyDurableNodeBatch,
  emptyStreamContentState,
  upsertConversationNodes,
} from './conversation-sync.js'

const userNode = (
  id: string,
  runId: string | null,
  content: string
): MessageNode => ({
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
  encoded: { role: 'user', content },
  createdAt: 0,
})

const textDelta = (
  eventId: number,
  delta: string,
  runId = 'run-1'
): ContentEvent => ({
  _tag: 'TextDelta',
  sessionId: 'session-1',
  runId,
  eventId,
  delta,
})

describe('conversation synchronization', () => {
  it('incrementally upserts by id while preserving order and unchanged identity', () => {
    const first = userNode('first', null, 'first')
    const changed = userNode('changed', 'run-1', 'before')
    const replacement = userNode('changed', 'run-1', 'after')
    const appended = userNode('appended', 'run-1', 'last')

    const result = upsertConversationNodes(
      [first, changed],
      [replacement, appended]
    )

    expect(result.map((node) => node.id)).toEqual([
      'first',
      'changed',
      'appended',
    ])
    expect(result[0]).toBe(first)
    expect(result[1]).toBe(replacement)
  })

  it('ignores a duplicate durable sequence', () => {
    const current = userNode('current', null, 'current')
    const state = { sequence: 4, nodes: [current] }
    const result = applyDurableNodeBatch(state, {
      sequence: 4,
      runId: 'run-1',
      nodes: [userNode('duplicate', 'run-1', 'duplicate')],
    })

    expect(result).toBe(state)
  })

  it('replays event batches newer than an in-flight snapshot', () => {
    const historical = userNode('historical', null, 'historical')
    const current = userNode('current', 'run-1', 'current')
    const result = applyConversationSnapshot(
      { sequence: 7, nodes: [current] },
      { sequence: 5, nodes: [historical] },
      [{ sequence: 7, runId: 'run-1', nodes: [current] }]
    )

    expect(result.sequence).toBe(7)
    expect(result.nodes.map((node) => node.id)).toEqual([
      'historical',
      'current',
    ])
  })

  it('retains a sequence-only active lifecycle event across a snapshot race', () => {
    const historical = userNode('historical', null, 'historical')
    const result = applyConversationSnapshot(
      { sequence: 6, nodes: [historical] },
      { sequence: 5, nodes: [historical] },
      [{ sequence: 6, runId: 'run-1', nodes: [] }]
    )

    expect(result.sequence).toBe(6)
    expect(result.nodes).toEqual([historical])
  })

  it('preserves an optimistic node added while a snapshot is in flight', () => {
    const historical = userNode('historical', null, 'historical')
    const optimistic = userNode('optimistic-run-1', 'run-1', 'pending')

    const result = applyConversationSnapshot(
      { sequence: 5, nodes: [historical, optimistic] },
      { sequence: 5, nodes: [historical] },
      []
    )

    expect(result.nodes).toEqual([historical, optimistic])
    expect(result.nodes[1]).toBe(optimistic)
  })

  it('atomically replaces an optimistic user node with its committed node', () => {
    const optimistic = userNode('optimistic-run-1', 'run-1', 'hello')
    const committed = userNode('committed', 'run-1', 'hello')

    const result = upsertConversationNodes([optimistic], [committed])

    expect(result).toEqual([committed])
  })

  it('acknowledges only a content prefix and preserves the next delta', () => {
    const state = appendContentEvent(
      appendContentEvent(emptyStreamContentState, textDelta(1, 'persisted')),
      textDelta(2, 'next')
    )

    const result = acknowledgeContentThrough(state, 1)

    expect(result.events.map((event) => event.eventId)).toEqual([2])
    expect(result.parts).toEqual([{ type: 'text', text: 'next' }])
  })

  it('ignores a late delta that is already acknowledged', () => {
    const acknowledged = acknowledgeContentThrough(emptyStreamContentState, 3)

    const result = appendContentEvent(acknowledged, textDelta(2, 'late'))

    expect(result).toBe(acknowledged)
    expect(result.parts).toEqual([])
  })

  it('acknowledges background compaction summary content at handoff', () => {
    const streamed = appendContentEvent(
      emptyStreamContentState,
      textDelta(4, 'summary', 'background-summary')
    )

    const persisted = acknowledgeContentThrough(streamed, 4)
    const late = appendContentEvent(
      persisted,
      textDelta(3, 'duplicate', 'background-summary')
    )

    expect(persisted.parts).toEqual([])
    expect(late).toBe(persisted)
  })
})
