import type { MessageNode } from '$lib/types.js'
import type { SelectedHead } from '$lib/selected-head-storage.js'

export const reconcileSelectedHead = (
  head: SelectedHead,
  ids: ReadonlySet<string>,
  initialized: boolean
): SelectedHead => {
  if (initialized) return head
  if (head === null) return null
  if (head.type === 'node') return ids.has(head.nodeId) ? head : null
  return head.baseNodeId === null || ids.has(head.baseNodeId) ? head : null
}

export const renderHeadWhileNodePending = (
  selectedHead: SelectedHead,
  ids: ReadonlySet<string>,
  fallbackHead: SelectedHead
): SelectedHead =>
  selectedHead?.type === 'node' && !ids.has(selectedHead.nodeId)
    ? fallbackHead
    : selectedHead

export const hasTerminalPersistedRun = (
  messages: ReadonlyArray<MessageNode>,
  runId: string
): boolean =>
  messages.some(
    (message) =>
      message.runId === runId &&
      message.run !== null &&
      message.run.status !== 'running'
  )

export const shouldResolveRunHead = (
  messages: ReadonlyArray<MessageNode>,
  runId: string,
  active: boolean,
  eventCompletion: boolean
): boolean =>
  !active && (eventCompletion || hasTerminalPersistedRun(messages, runId))

export const isDescendantOrSame = (
  messages: ReadonlyArray<MessageNode>,
  nodeId: string,
  ancestorId: string | null
): boolean => {
  if (ancestorId === null) return true

  const byId = new Map(messages.map((message) => [message.id, message]))
  const seen = new Set<string>()
  let cursor: string | null = nodeId

  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }

  return false
}

export const completedRunHead = (
  messages: ReadonlyArray<MessageNode>,
  runId: string,
  baseNodeId: string | null,
  durableFocusNodeId: string | null | undefined
): SelectedHead => {
  if (
    durableFocusNodeId !== undefined &&
    durableFocusNodeId !== null &&
    messages.some((message) => message.id === durableFocusNodeId)
  ) {
    return { type: 'node', nodeId: durableFocusNodeId }
  }

  const finalNode = messages
    .toReversed()
    .find(
      (message) =>
        message.runId === runId &&
        !message.id.startsWith('optimistic-') &&
        isDescendantOrSame(messages, message.id, baseNodeId)
    )
  if (finalNode !== undefined) return { type: 'node', nodeId: finalNode.id }
  return baseNodeId === null ? null : { type: 'node', nodeId: baseNodeId }
}
