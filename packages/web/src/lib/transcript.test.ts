import { describe, expect, it } from 'vitest'
import type { MessageNode } from '$lib/types.js'
import {
  latestAgentSystemPrompt,
  virtualSystemPromptItem,
} from './transcript.js'

const node = (
  id: string,
  runId: string,
  kind: 'agent' | 'summary',
  systemPromptId: string | null
): MessageNode => ({
  id,
  sessionId: 'session',
  parentId: null,
  kind: 'message',
  messageId: id,
  summaryId: null,
  sourceNodeId: null,
  runId,
  run: {
    id: runId,
    status: 'completed',
    kind,
    systemPromptId,
    attribution: {
      providerId: 'provider',
      modelId: 'model',
      billingMode: 'api-key',
    },
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
    completedAt: 1,
  },
  modelCall: null,
  encoded: { role: 'assistant', content: 'response' },
  createdAt: 0,
})

describe('system prompt transcript projection', () => {
  it('selects the latest agent prompt on the supplied branch', () => {
    expect(
      latestAgentSystemPrompt([
        node('first', 'run-1', 'agent', 'prompt-1'),
        node('summary', 'run-2', 'summary', 'summary-prompt'),
        node('latest', 'run-3', 'agent', 'prompt-3'),
      ])
    ).toEqual({ runId: 'run-3', promptId: 'prompt-3' })
  })

  it('ignores runs without an effective agent prompt', () => {
    expect(
      latestAgentSystemPrompt([
        node('agent', 'run-1', 'agent', null),
        node('summary', 'run-2', 'summary', 'summary-prompt'),
      ])
    ).toBeNull()
  })

  it('creates a non-persisted transcript item', () => {
    expect(virtualSystemPromptItem('prompt', 'System text')).toEqual({
      type: 'message',
      source: {
        type: 'virtual',
        key: 'prompt',
        part: { type: 'text', text: 'System text' },
      },
      part: { type: 'text', text: 'System text' },
    })
  })
})
