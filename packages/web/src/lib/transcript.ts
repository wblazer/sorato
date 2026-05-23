import type {
  MessageNode,
  MessagePart,
  ToolCallPart,
  ToolResultPart,
} from '$lib/types.js'

export type TranscriptSource =
  | {
      type: 'persisted'
      message: MessageNode
      part: MessagePart
    }
  | {
      type: 'streaming'
      part: MessagePart
    }

export type TranscriptItem =
  | {
      type: 'message'
      source: TranscriptSource
      part: MessagePart
    }
  | {
      type: 'combined-tool'
      call: ToolCallPart
      result?: ToolResultPart | undefined
      callSource: TranscriptSource
      resultSource?: TranscriptSource | undefined
    }

export const messageParts = (
  message: MessageNode
): ReadonlyArray<MessagePart> => {
  const content = message.encoded.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content as MessagePart[]
  return []
}

export const persistedSources = (
  messages: ReadonlyArray<MessageNode>
): ReadonlyArray<TranscriptSource> =>
  messages.flatMap((message) =>
    messageParts(message).map((part) => ({ type: 'persisted', message, part }))
  )

export const streamingSources = (
  parts: ReadonlyArray<MessagePart>
): ReadonlyArray<TranscriptSource> =>
  parts.map((part) => ({ type: 'streaming', part }))

export const projectTranscript = (
  sources: ReadonlyArray<TranscriptSource>,
  options: { readonly pretty: boolean }
): ReadonlyArray<TranscriptItem> => {
  if (!options.pretty) {
    return sources.map((source) => ({
      type: 'message',
      source,
      part: source.part,
    }))
  }

  const results = new Map<
    string,
    { part: ToolResultPart; source: TranscriptSource }
  >()
  for (const source of sources) {
    if (source.part.type === 'tool-result') {
      results.set(source.part.id, { part: source.part, source })
    }
  }

  return sources.flatMap((source): TranscriptItem[] => {
    const part = source.part
    if (part.type === 'tool-call') {
      const result = results.get(part.id)
      return [
        {
          type: 'combined-tool',
          call: part,
          result: result?.part,
          callSource: source,
          resultSource: result?.source,
        },
      ]
    }
    if (part.type === 'tool-result') return []
    return [{ type: 'message', source, part }]
  })
}
