import type { MessageNodeResponse } from '@sorato/api'

type EncodedContent = MessageNodeResponse['encoded']['content']

/** A part exactly as represented by the persisted HTTP response. */
export type TranscriptPart = Exclude<EncodedContent, string | undefined>[number]
export type ToolCallPart = Extract<
  TranscriptPart,
  { readonly type: 'tool-call' }
>
export type ToolResultPart = Extract<
  TranscriptPart,
  { readonly type: 'tool-result' }
>

/** Rendering metadata remains attached to every projected part. */
export interface TranscriptSource {
  readonly type: 'persisted'
  readonly message: MessageNodeResponse
  readonly messageId: string
  readonly role: MessageNodeResponse['encoded']['role']
  readonly runId: string | null
  readonly partIndex: number
  readonly part: TranscriptPart
}

export type TranscriptItem =
  | {
      readonly type: 'message'
      readonly source: TranscriptSource
      readonly part: TranscriptPart
    }
  | {
      readonly type: 'combined-tool'
      readonly call: ToolCallPart
      readonly result?: ToolResultPart
      readonly callSource: TranscriptSource
      readonly resultSource?: TranscriptSource
    }
  | {
      readonly type: 'interruption'
      readonly source: TranscriptSource
    }

export interface TranscriptBlock {
  readonly type: 'message' | 'assistant-tool-group'
  readonly key: string
  readonly messages: ReadonlyArray<MessageNodeResponse>
  readonly items: ReadonlyArray<TranscriptItem>
  readonly runId: string | null
}

/**
 * Normalizes only the representation boundary: strings become text parts,
 * while structured parts (including JSON tool parameters) are left intact.
 */
export const messageParts = (
  message: MessageNodeResponse
): ReadonlyArray<TranscriptPart> => {
  const content = message.encoded.content
  if (content === undefined) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

export const persistedSources = (
  messages: ReadonlyArray<MessageNodeResponse>
): ReadonlyArray<TranscriptSource> =>
  messages.flatMap((message) =>
    messageParts(message).map((part, partIndex) => ({
      type: 'persisted' as const,
      message,
      messageId: message.id,
      role: message.encoded.role,
      runId: message.runId,
      partIndex,
      part,
    }))
  )

const isInterruptedAgentSource = (source: TranscriptSource): boolean =>
  source.message.run?.status === 'interrupted' &&
  (source.role === 'assistant' || source.role === 'tool')

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
    { readonly part: ToolResultPart; readonly source: TranscriptSource }
  >()
  const callIndexes = new Map<string, number>()
  sources.forEach((source, index) => {
    if (source.part.type === 'tool-call') callIndexes.set(source.part.id, index)
    if (source.part.type === 'tool-result') {
      results.set(source.part.id, { part: source.part, source })
    }
  })

  // Tool results render at their matching call, so interruption follows that
  // rendered position rather than the hidden result's persisted position.
  const interruptionIndexes = new Map<string, number>()
  sources.forEach((source, index) => {
    if (!isInterruptedAgentSource(source) || source.runId === null) return
    const renderedIndex =
      source.part.type === 'tool-result'
        ? (callIndexes.get(source.part.id) ?? index)
        : index
    interruptionIndexes.set(
      source.runId,
      Math.max(interruptionIndexes.get(source.runId) ?? -1, renderedIndex)
    )
  })

  return sources.flatMap((source, index): ReadonlyArray<TranscriptItem> => {
    const interrupted =
      source.runId !== null && interruptionIndexes.get(source.runId) === index
        ? ([{ type: 'interruption', source }] as const)
        : []
    if (source.part.type === 'tool-call') {
      const result = results.get(source.part.id)
      return [
        {
          type: 'combined-tool',
          call: source.part,
          ...(result === undefined
            ? {}
            : { result: result.part, resultSource: result.source }),
          callSource: source,
        },
        ...interrupted,
      ]
    }
    if (source.part.type === 'tool-result') return interrupted
    return [{ type: 'message', source, part: source.part }, ...interrupted]
  })
}

const isAgentMessage = (message: MessageNodeResponse): boolean =>
  message.encoded.role === 'assistant' || message.encoded.role === 'tool'

/** Groups contiguous assistant/tool messages using the session view semantics. */
export const projectTranscriptBlocks = (
  messages: ReadonlyArray<MessageNodeResponse>,
  options: { readonly pretty: boolean }
): ReadonlyArray<TranscriptBlock> => {
  const items = projectTranscript(persistedSources(messages), options)
  const blocks: TranscriptBlock[] = []
  const sourceMessage = (item: TranscriptItem): MessageNodeResponse =>
    item.type === 'combined-tool'
      ? item.callSource.message
      : item.source.message

  for (let index = 0; index < messages.length; index++) {
    const first = messages[index]
    if (first === undefined) continue
    const group = [first]
    if (isAgentMessage(first)) {
      while (index + 1 < messages.length) {
        const next = messages[index + 1]
        if (next === undefined || !isAgentMessage(next)) break
        group.push(next)
        index++
      }
    }
    blocks.push({
      type: isAgentMessage(first) ? 'assistant-tool-group' : 'message',
      key: first.id,
      messages: group,
      items: items.filter((item) => group.includes(sourceMessage(item))),
      runId: first.runId,
    })
  }
  return blocks
}
