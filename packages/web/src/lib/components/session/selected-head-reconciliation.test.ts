import { describe, expect, it } from 'vitest'
import type { MessageNode } from '$lib/types.js'
import {
  completedRunHead,
  hasTerminalPersistedRun,
  reconcileSelectedHead,
  renderHeadWhileNodePending,
  shouldResolveRunHead,
} from './selected-head-reconciliation.js'

const node = (status: 'running' | 'completed'): MessageNode => ({
  id: 'node-1',
  sessionId: 'session-1',
  parentId: null,
  kind: 'message',
  messageId: 'message-1',
  summaryId: null,
  sourceNodeId: null,
  runId: 'run-1',
  run: {
    id: 'run-1',
    status,
    providerId: 'provider',
    modelId: 'model',
    billingMode: 'api-key',
    usage: {
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      contextWindowTokens: null,
      actualCostMicrosUsd: null,
      listPriceMicrosUsd: null,
    },
    createdAt: 0,
    completedAt: status === 'completed' ? 1 : null,
  },
  modelCall: null,
  encoded: { role: 'assistant', content: [] },
  createdAt: 0,
})

describe('selected head reconciliation', () => {
  it('retains an initialized stop focus while its node is pending', () => {
    const pending = { type: 'node' as const, nodeId: 'pending-node' }
    const fallback = {
      type: 'run' as const,
      runId: 'run-1',
      baseNodeId: 'base-node',
    }

    expect(reconcileSelectedHead(pending, new Set(), true)).toBe(pending)
    expect(reconcileSelectedHead(pending, new Set(), false)).toBeNull()
    expect(renderHeadWhileNodePending(pending, new Set(), fallback)).toBe(
      fallback
    )
    expect(
      renderHeadWhileNodePending(pending, new Set(['pending-node']), fallback)
    ).toBe(pending)
  })

  it('infers completion only from terminal persisted run metadata', () => {
    expect(hasTerminalPersistedRun([node('completed')], 'run-1')).toBe(true)
    expect(hasTerminalPersistedRun([node('running')], 'run-1')).toBe(false)
    expect(
      shouldResolveRunHead([node('completed')], 'run-1', true, false)
    ).toBe(false)
    expect(
      shouldResolveRunHead([node('completed')], 'run-1', false, false)
    ).toBe(true)
  })

  it('focuses the committed replacement branch after compaction', () => {
    const oldBase = {
      ...node('completed'),
      id: 'old-base',
      runId: 'old-run',
    }
    const summary = {
      ...node('completed'),
      id: 'summary',
      parentId: null,
      kind: 'summary' as const,
      messageId: null,
      summaryId: 'summary-record',
      runId: 'compaction-run',
      encoded: {
        role: 'user' as const,
        source: 'summary' as const,
        content: 'Compacted context',
      },
    }
    const replacementHead = {
      ...node('completed'),
      id: 'replacement-head',
      parentId: summary.id,
      runId: 'old-run',
    }

    expect(
      completedRunHead(
        [oldBase, summary, replacementHead],
        'compaction-run',
        oldBase.id,
        replacementHead.id
      )
    ).toEqual({ type: 'node', nodeId: replacementHead.id })
  })
})
