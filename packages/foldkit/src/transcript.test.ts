import { MessageNodeResponse } from '@sorato/api'
import { describe, expect, it } from 'vitest'
import {
  messageParts,
  persistedSources,
  projectTranscript,
  projectTranscriptBlocks,
  type ToolResultPart,
  type TranscriptPart,
} from './transcript.ts'

const node = (
  id: string,
  role: 'user' | 'assistant',
  content: string | ReadonlyArray<TranscriptPart>,
  options: { readonly runId?: string; readonly interrupted?: boolean } = {}
) =>
  MessageNodeResponse.make({
    id,
    sessionId: 'session',
    parentId: null,
    kind: 'message',
    messageId: id,
    summaryId: null,
    sourceNodeId: null,
    runId: options.runId ?? null,
    run: options.interrupted
      ? {
          id: options.runId ?? 'run',
          status: 'interrupted',
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
          createdAt: 1,
          completedAt: 2,
        }
      : null,
    modelCall: null,
    encoded: { role, content },
    createdAt: 1,
  })

const toolNode = (
  id: string,
  content: ReadonlyArray<ToolResultPart>,
  options: { readonly runId?: string; readonly interrupted?: boolean } = {}
) => {
  const assistant = node(id, 'assistant', [], options)
  return MessageNodeResponse.make({
    ...assistant,
    encoded: { role: 'tool', content },
  })
}

describe('transcript projection', () => {
  it('pairs a tool call and result by id in pretty mode and retains metadata', () => {
    const params = { path: 'README.md', range: [1, 3] }
    const messages = [
      node('call-message', 'assistant', [
        { type: 'tool-call', id: 'one', name: 'read', params },
      ]),
      toolNode('result-message', [
        {
          type: 'tool-result',
          id: 'one',
          name: 'read',
          isFailure: false,
          result: 'contents',
        },
      ]),
    ]
    const items = projectTranscript(persistedSources(messages), {
      pretty: true,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'combined-tool',
      call: { params },
      result: { result: 'contents' },
      callSource: {
        messageId: 'call-message',
        role: 'assistant',
        partIndex: 0,
      },
      resultSource: { messageId: 'result-message', role: 'tool', partIndex: 0 },
    })
  })

  it('omits standalone results in pretty mode', () => {
    const result = toolNode('result', [
      {
        type: 'tool-result',
        id: 'missing',
        name: 'read',
        isFailure: true,
        result: 'failed',
      },
    ])
    expect(
      projectTranscript(persistedSources([result]), { pretty: true })
    ).toEqual([])
  })

  it('preserves every source in source order in raw mode', () => {
    const message = node('assistant', 'assistant', [
      { type: 'tool-call', id: 'one', name: 'read', params: { nested: true } },
      {
        type: 'tool-result',
        id: 'one',
        name: 'read',
        isFailure: false,
        result: '{"not":"flattened"}',
      },
    ])
    const items = projectTranscript(persistedSources([message]), {
      pretty: false,
    })
    expect(items.map((item) => item.type)).toEqual(['message', 'message'])
    expect(
      items.map((item) => item.type === 'message' && item.part.type)
    ).toEqual(['tool-call', 'tool-result'])
  })

  it('places interruption after the last rendered assistant/tool source', () => {
    const messages = [
      node(
        'call',
        'assistant',
        [
          { type: 'tool-call', id: 'one', name: 'read', params: {} },
          { type: 'reasoning', text: 'still thinking' },
          { type: 'text', text: 'final answer' },
        ],
        { runId: 'run', interrupted: true }
      ),
      toolNode(
        'result',
        [
          {
            type: 'tool-result',
            id: 'one',
            name: 'read',
            isFailure: false,
            result: 'ok',
          },
        ],
        { runId: 'run', interrupted: true }
      ),
    ]
    expect(
      projectTranscript(persistedSources(messages), { pretty: true }).map(
        (item) => item.type
      )
    ).toEqual(['combined-tool', 'message', 'message', 'interruption'])
  })

  it('normalizes strings and preserves multiple text, reasoning, file and JSON parts', () => {
    expect(messageParts(node('text', 'user', 'hello'))).toEqual([
      { type: 'text', text: 'hello' },
    ])
    const parts: ReadonlyArray<TranscriptPart> = [
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'answer' },
      {
        type: 'file',
        mediaType: 'text/plain',
        fileName: 'a.txt',
        data: 'data',
      },
      { type: 'tool-call', id: 'call', name: 'write', params: { value: 42 } },
    ]
    const sources = persistedSources([node('many', 'assistant', parts)])
    expect(sources.map((source) => source.part)).toEqual(parts)
    expect(sources.map((source) => source.partIndex)).toEqual([0, 1, 2, 3])
  })

  it('groups contiguous assistant and tool messages without changing item order', () => {
    const messages = [
      node('user', 'user', 'question'),
      node('assistant', 'assistant', 'answer'),
      toolNode('tool', []),
      node('next-user', 'user', 'next'),
    ]
    const blocks = projectTranscriptBlocks(messages, { pretty: true })
    expect(
      blocks.map((block) => [block.type, block.messages.map((m) => m.id)])
    ).toEqual([
      ['message', ['user']],
      ['assistant-tool-group', ['assistant', 'tool']],
      ['message', ['next-user']],
    ])
  })
})
