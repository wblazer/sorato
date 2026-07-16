import { describe, expect, it } from 'vitest'
import type { AvailableModel, MessageNode, ModelCall } from '$lib/types.js'
import { sessionTokenUsage } from './session-token-usage.js'

const model: AvailableModel = {
  id: 'provider/model',
  name: 'Model',
  provider: 'provider',
  capabilities: {
    attachment: false,
    reasoning: false,
    temperature: false,
    toolCall: true,
    thinkingLevels: [],
    modes: [],
    limits: { context: 1_000, output: 100 },
  },
}

const modelCall = (
  id: string,
  contextWindowTokens: number | null,
  totalTokens = 10
): ModelCall => ({
  id: `call:${id}`,
  sessionId: 'session',
  runId: `run:${id}`,
  assistantNodeId: id,
  providerId: 'provider',
  modelId: 'model',
  billingMode: 'api-key',
  inputTokens: totalTokens,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens,
  contextWindowTokens,
  actualCostMicrosUsd: 0,
  listPriceMicrosUsd: 0,
  startedAt: 0,
  finishedAt: 0,
})

const message = (
  id: string,
  kind: MessageNode['kind'],
  call: ModelCall | null,
  sourceNodeId: string | null = null
): MessageNode => ({
  id,
  sessionId: 'session',
  parentId: null,
  kind,
  messageId: kind === 'message' ? `message:${id}` : null,
  summaryId: kind === 'summary' ? `summary:${id}` : null,
  sourceNodeId,
  runId: call?.runId ?? null,
  run: null,
  modelCall: call,
  encoded:
    kind === 'summary'
      ? { role: 'user', source: 'summary', content: 'summary' }
      : { role: 'assistant', content: id },
  createdAt: 0,
})

describe('sessionTokenUsage', () => {
  it('uses the latest context metadata on the selected visible path', () => {
    const usage = sessionTokenUsage(
      [
        message('first', 'message', modelCall('first', 100)),
        message('second', 'message', modelCall('second', 250)),
      ],
      [model]
    )

    expect(usage?.currentContextTokens).toBe(250)
    expect(usage?.contextPercent).toBe(25)
  })

  it('does not treat a soft copied node as owning the original model call', () => {
    const originalCall = modelCall('original', 800)
    const usage = sessionTokenUsage(
      [
        message('summary', 'summary', null),
        message('copy', 'message', originalCall, 'original'),
      ],
      [model]
    )

    expect(usage).toBeNull()
  })

  it('uses context metadata from original nodes even after a summary', () => {
    const usage = sessionTokenUsage(
      [
        message('summary', 'summary', null),
        message('after-summary', 'message', modelCall('after-summary', 120)),
      ],
      [model]
    )

    expect(usage?.currentContextTokens).toBe(120)
    expect(usage?.contextPercent).toBe(12)
  })
})
