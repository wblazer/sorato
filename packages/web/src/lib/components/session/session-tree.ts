import type { MessageEncoded, MessageNode } from '$lib/types.js'
import type { SelectedHead } from '$lib/selected-head-storage.js'

export interface MessageTreeNode {
  readonly message: MessageNode
  readonly children: ReadonlyArray<MessageTreeNode>
}

export function buildMessageTree(
  messages: ReadonlyArray<MessageNode>
): ReadonlyArray<MessageTreeNode> {
  const childrenByParent = new Map<string | null, MessageNode[]>()

  for (const message of messages) {
    const siblings = childrenByParent.get(message.parentId) ?? []
    siblings.push(message)
    childrenByParent.set(message.parentId, siblings)
  }

  const seen = new Set<string>()
  const build = (message: MessageNode): MessageTreeNode => {
    if (seen.has(message.id)) return { message, children: [] }
    seen.add(message.id)
    return {
      message,
      children: (childrenByParent.get(message.id) ?? []).map(build),
    }
  }

  const roots = (childrenByParent.get(null) ?? []).map(build)
  const attached = new Set<string>()
  const collect = (node: MessageTreeNode) => {
    attached.add(node.message.id)
    for (const child of node.children) collect(child)
  }
  for (const root of roots) collect(root)

  const orphanRoots = messages
    .filter((message) => !attached.has(message.id))
    .map(build)

  return [...roots, ...orphanRoots]
}

export function pathIdsForHead(
  messages: ReadonlyArray<MessageNode>,
  head: SelectedHead
): ReadonlySet<string> {
  const ids = new Set<string>()
  if (head === null) return ids

  const byId = new Map(messages.map((message) => [message.id, message]))
  let cursor = head.type === 'node' ? head.nodeId : head.baseNodeId

  while (cursor !== null && !ids.has(cursor)) {
    ids.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }

  if (head.type === 'run') ids.add(runTreeNodeId(head.runId))
  return ids
}

export function runTreeNodeId(runId: string) {
  return `run:${runId}`
}

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
  if (message.kind === 'summary') return 'Compacted context summary'
  return encodedPreview(message.encoded) || '(empty)'
}

function encodedPreview(message: MessageEncoded): string {
  if (message.role === 'tool') return partsText(message.content)
  const content = message.content
  if (typeof content === 'string') return compactWhitespace(content)
  if (!content) return ''
  return partsText(content)
}

function partsText(
  parts: ReadonlyArray<
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'reasoning'; readonly text: string }
    | { readonly type: 'file'; readonly fileName?: string }
    | { readonly type: 'tool-call'; readonly name: string }
    | {
        readonly type: 'tool-result'
        readonly name: string
        readonly result: string
      }
  >
): string {
  return compactWhitespace(
    parts
      .map((part) => {
        switch (part.type) {
          case 'text':
          case 'reasoning':
            return part.text
          case 'file':
            return part.fileName ? `[file: ${part.fileName}]` : '[file]'
          case 'tool-call':
            return `[tool call: ${part.name}]`
          case 'tool-result':
            return `[tool result: ${part.name}] ${part.result}`
        }
      })
      .filter((text) => text.length > 0)
      .join(' ')
  )
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
