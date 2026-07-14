import type { MessageEncoded, MessageNode } from '$lib/types.js'

export function messageLabel(message: MessageNode): string {
  if (message.kind === 'summary') return 'Summary'

  switch (message.encoded.role) {
    case 'user':
      return 'User'
    case 'assistant':
      return 'Assistant'
    case 'tool':
      return 'Tool'
    case 'system':
      return message.encoded.display?.title ?? 'System'
  }
}

export function messagePreview(message: MessageNode): string {
  return (
    encodedPreview(message.encoded) ||
    (message.kind === 'summary' ? 'Summary' : '(empty)')
  )
}

export function messageNarrativePreview(message: MessageNode): string {
  return (
    encodedNarrativePreview(message.encoded) ||
    (message.kind === 'summary' ? 'Summary' : '')
  )
}

function encodedPreview(message: MessageEncoded): string {
  const summary = summaryDisplayContent(message)
  if (summary !== null) return compactWhitespace(summary)
  if (message.role === 'tool') return partsText(message.content)
  const content = message.content
  if (typeof content === 'string') return compactWhitespace(content)
  if (!content) return ''
  return partsText(content)
}

function encodedNarrativePreview(message: MessageEncoded): string {
  const summary = summaryDisplayContent(message)
  if (summary !== null) return compactWhitespace(summary)
  if (message.role === 'tool') return ''
  const content = message.content
  if (typeof content === 'string') return compactWhitespace(content)
  if (!content) return ''
  return narrativePartsText(content)
}

function summaryDisplayContent(message: MessageEncoded): string | null {
  if (message.role !== 'user' || message.source !== 'summary') return null
  return message.metadata?.summary?.content ?? ''
}

function partsText(
  parts: ReadonlyArray<{
    readonly type: string
    readonly [key: string]: unknown
  }>
): string {
  return compactWhitespace(
    parts
      .map((part) => {
        switch (part.type) {
          case 'text':
          case 'reasoning':
            return typeof part.text === 'string' ? part.text : ''
          case 'file':
            return typeof part.fileName === 'string'
              ? `[file: ${part.fileName}]`
              : '[file]'
          case 'tool-call':
            return typeof part.name === 'string'
              ? `[tool call: ${part.name}]`
              : '[tool call]'
          case 'tool-result':
            return typeof part.name === 'string'
              ? `[tool result: ${part.name}] ${displayUnknown(part.result)}`
              : `[tool result] ${displayUnknown(part.result)}`
          default:
            return ''
        }
      })
      .filter((text) => text.length > 0)
      .join(' ')
  )
}

function narrativePartsText(
  parts: ReadonlyArray<{
    readonly type: string
    readonly [key: string]: unknown
  }>
): string {
  return compactWhitespace(
    parts
      .map((part) => {
        switch (part.type) {
          case 'text':
          case 'reasoning':
            return typeof part.text === 'string' ? part.text : ''
          case 'file':
            return typeof part.fileName === 'string'
              ? `[file: ${part.fileName}]`
              : '[file]'
          case 'tool-call':
          case 'tool-result':
          default:
            return ''
        }
      })
      .filter((text) => text.length > 0)
      .join(' ')
  )
}

function displayUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return ''
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
