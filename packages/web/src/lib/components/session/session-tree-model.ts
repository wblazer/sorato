import type { SelectedHead } from '$lib/selected-head-storage.js'
import type { ActiveRunSummary, MessageNode } from '$lib/types.js'
import type { MessageIconName } from '@sorato/core/presentation'

export interface ToolCallSummary {
  readonly id: string
  readonly name: string
  readonly icon?: MessageIconName | undefined
}

export interface SessionTreeNodeGroup {
  readonly type: 'node-group'
  readonly id: string
  readonly nodeIds: ReadonlyArray<string>
  readonly message: MessageNode
  readonly displayMessage: MessageNode
  readonly combinedRun: boolean
  readonly toolCallCount: number
  readonly toolCalls: ReadonlyArray<ToolCallSummary>
  readonly unresolvedToolCallCount: number
  readonly compactRange: {
    readonly startNodeId: string
    readonly endNodeId: string
  }
  readonly children: ReadonlyArray<SessionTreeItem>
}

export interface SessionTreeActiveRun {
  readonly type: 'active-run'
  readonly id: string
  readonly run: ActiveRunSummary
  readonly attachment:
    | { readonly type: 'root' }
    | { readonly type: 'attached'; readonly parentItemId: string }
    | { readonly type: 'unresolved'; readonly nodeId: string }
  readonly children: ReadonlyArray<SessionTreeItem>
}

export type SessionTreeItem = SessionTreeNodeGroup | SessionTreeActiveRun

export type SessionTreeDiagnostic =
  | {
      readonly type: 'missing-run-anchor'
      readonly runId: string
      readonly nodeId: string
    }
  | {
      readonly type: 'ambiguous-run-anchor'
      readonly runId: string
      readonly nodeIds: ReadonlyArray<string>
    }

export interface SessionTreeModel {
  readonly roots: ReadonlyArray<SessionTreeItem>
  readonly itemById: ReadonlyMap<string, SessionTreeItem>
  readonly ownerByNodeId: ReadonlyMap<string, string>
  readonly parentByItemId: ReadonlyMap<string, string>
  readonly diagnostics: ReadonlyArray<SessionTreeDiagnostic>
}

export interface BuildSessionTreeModelInput {
  readonly messages: ReadonlyArray<MessageNode>
  readonly activeRuns: ReadonlyArray<ActiveRunSummary>
  readonly groupAgentSteps: boolean
}

type MutableSessionTreeItem =
  | (Omit<SessionTreeNodeGroup, 'children'> & {
      children: Array<SessionTreeItem>
    })
  | (Omit<SessionTreeActiveRun, 'children'> & {
      children: Array<SessionTreeItem>
    })

type RunAnchor =
  | { readonly type: 'root' }
  | { readonly type: 'node'; readonly nodeId: string }
  | { readonly type: 'run'; readonly runId: string }

const nodeItemId = (nodeId: string) => `node:${nodeId}`
const runItemId = (runId: string) => `run:${runId}`

export function buildSessionTreeModel({
  messages,
  activeRuns,
  groupAgentSteps,
}: BuildSessionTreeModelInput): SessionTreeModel {
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const childrenByParent = new Map<string | null, Array<MessageNode>>()
  for (const message of messages) {
    const children = childrenByParent.get(message.parentId) ?? []
    children.push(message)
    childrenByParent.set(message.parentId, children)
  }

  const diagnostics: Array<SessionTreeDiagnostic> = []
  const activeRunsById = new Map(activeRuns.map((run) => [run.runId, run]))
  const runAnchors = new Map<string, RunAnchor>()
  for (const run of activeRuns) {
    if (run.parentRunId && activeRunsById.has(run.parentRunId)) {
      runAnchors.set(run.runId, { type: 'run', runId: run.parentRunId })
      continue
    }

    const anchorLeaves =
      run.kind === 'agent'
        ? runMessageLeaves(
            messages,
            messagesById,
            childrenByParent,
            run,
            groupAgentSteps ? isPrompt : () => true
          )
        : []
    if (anchorLeaves.length === 1) {
      const anchor = anchorLeaves[0]
      if (anchor) runAnchors.set(run.runId, { type: 'node', nodeId: anchor.id })
      continue
    }
    if (anchorLeaves.length > 1) {
      diagnostics.push({
        type: 'ambiguous-run-anchor',
        runId: run.runId,
        nodeIds: anchorLeaves.map((message) => message.id),
      })
    }

    runAnchors.set(
      run.runId,
      run.baseNodeId === null
        ? { type: 'root' }
        : { type: 'node', nodeId: run.baseNodeId }
    )
  }

  const activeAgentRunsById = new Map(
    activeRuns
      .filter((run) => run.kind === 'agent')
      .map((run) => [run.runId, run])
  )
  const hiddenNodeOwner = new Map<string, string>()
  for (const message of messages) {
    const activeRun =
      message.runId === null
        ? undefined
        : activeAgentRunsById.get(message.runId)
    if (
      activeRun &&
      groupAgentSteps &&
      isDescendantOrSame(messagesById, message.id, activeRun.baseNodeId) &&
      isAgentStep(message)
    ) {
      hiddenNodeOwner.set(message.id, runItemId(activeRun.runId))
    }
  }

  const runAnchorsByNodeId = new Set(
    [...runAnchors.values()].flatMap((anchor) =>
      anchor.type === 'node' ? [anchor.nodeId] : []
    )
  )
  const toolExchangeEdges = groupAgentSteps
    ? new Set<string>()
    : findToolExchangeEdges(messages, childrenByParent, runAnchorsByNodeId)
  const successorByNodeId = new Map<string, string>()
  const predecessorByNodeId = new Map<string, string>()

  for (const parent of messages) {
    if (hiddenNodeOwner.has(parent.id) || runAnchorsByNodeId.has(parent.id))
      continue
    const children = childrenByParent.get(parent.id) ?? []
    if (children.length !== 1) continue
    const child = children[0]
    if (!child || hiddenNodeOwner.has(child.id)) continue

    const canGroup = groupAgentSteps
      ? sameAgentRun(parent, child)
      : toolExchangeEdges.has(edgeId(parent.id, child.id))
    if (!canGroup) continue

    successorByNodeId.set(parent.id, child.id)
    predecessorByNodeId.set(child.id, parent.id)
  }

  const itemById = new Map<string, MutableSessionTreeItem>()
  const ownerByNodeId = new Map<string, string>()
  const groupedNodeIds = new Set<string>()

  const addNodeGroup = (start: MessageNode) => {
    const groupedMessages: Array<MessageNode> = []
    let cursor: MessageNode | undefined = start
    while (cursor && !groupedNodeIds.has(cursor.id)) {
      groupedMessages.push(cursor)
      groupedNodeIds.add(cursor.id)
      const successorId = successorByNodeId.get(cursor.id)
      cursor = successorId ? messagesById.get(successorId) : undefined
    }

    const end = groupedMessages.at(-1)
    if (!end) return
    const id = nodeItemId(start.id)
    for (const message of groupedMessages) ownerByNodeId.set(message.id, id)

    const toolCalls = groupedMessages.flatMap(assistantToolCalls)
    const resolvedToolResultIds = new Set(
      groupedMessages.flatMap(toolResultIds)
    )
    const unresolvedToolCallCount = toolCalls.filter(
      (toolCall) => !resolvedToolResultIds.has(toolCall.id)
    ).length

    itemById.set(id, {
      type: 'node-group',
      id,
      nodeIds: groupedMessages.map((message) => message.id),
      message: start,
      displayMessage:
        groupedMessages.findLast((message) => !isToolMessage(message)) ?? start,
      combinedRun: groupAgentSteps && groupedMessages.length > 1,
      toolCallCount: toolCalls.length,
      toolCalls,
      unresolvedToolCallCount,
      compactRange: { startNodeId: start.id, endNodeId: end.id },
      children: [],
    })
  }

  for (const message of messages) {
    if (
      hiddenNodeOwner.has(message.id) ||
      predecessorByNodeId.has(message.id) ||
      groupedNodeIds.has(message.id)
    )
      continue
    addNodeGroup(message)
  }
  for (const message of messages) {
    if (!hiddenNodeOwner.has(message.id) && !groupedNodeIds.has(message.id))
      addNodeGroup(message)
  }

  for (const [nodeId, ownerId] of hiddenNodeOwner) {
    ownerByNodeId.set(nodeId, ownerId)
  }
  for (const run of activeRuns) {
    const id = runItemId(run.runId)
    const anchor = runAnchors.get(run.runId)
    const attachment = resolveRunAttachment(run.runId, anchor)
    if (attachment.type === 'unresolved') {
      diagnostics.push({
        type: 'missing-run-anchor',
        runId: run.runId,
        nodeId: attachment.nodeId,
      })
    }
    itemById.set(id, {
      type: 'active-run',
      id,
      run,
      attachment,
      children: [],
    })
  }

  const parentByItemId = new Map<string, string>()
  const childIdsByItemId = new Map<string, Array<string>>()
  const addEdge = (parentId: string, childId: string) => {
    if (
      parentId === childId ||
      !itemById.has(parentId) ||
      !itemById.has(childId)
    )
      return
    const existingParent = parentByItemId.get(childId)
    if (existingParent !== undefined && existingParent !== parentId) return
    parentByItemId.set(childId, parentId)
    const childIds = childIdsByItemId.get(parentId) ?? []
    if (!childIds.includes(childId)) childIds.push(childId)
    childIdsByItemId.set(parentId, childIds)
  }

  for (const message of messages) {
    if (message.parentId === null) continue
    const parentOwner = ownerByNodeId.get(message.parentId)
    const childOwner = ownerByNodeId.get(message.id)
    if (!parentOwner || !childOwner) continue
    if (itemById.get(childOwner)?.type === 'active-run') continue
    addEdge(parentOwner, childOwner)
  }

  for (const run of activeRuns) {
    const childId = runItemId(run.runId)
    const item = itemById.get(childId)
    if (item?.type === 'active-run' && item.attachment.type === 'attached')
      addEdge(item.attachment.parentItemId, childId)
  }

  for (const [parentId, childIds] of childIdsByItemId) {
    const parent = itemById.get(parentId)
    if (!parent) continue
    for (const childId of childIds) {
      const child = itemById.get(childId)
      if (child) parent.children.push(child)
    }
  }

  const roots = [...itemById.values()].filter(
    (item) => !parentByItemId.has(item.id)
  )

  return {
    roots,
    itemById,
    ownerByNodeId,
    parentByItemId,
    diagnostics,
  }

  function resolveRunAttachment(
    runId: string,
    anchor: RunAnchor | undefined
  ): SessionTreeActiveRun['attachment'] {
    if (!anchor || anchor.type === 'root') return { type: 'root' }
    if (anchor.type === 'run') {
      return { type: 'attached', parentItemId: runItemId(anchor.runId) }
    }

    const runItem = runItemId(runId)
    const seen = new Set<string>()
    let cursor: string | null = anchor.nodeId
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor)
      const owner = ownerByNodeId.get(cursor)
      if (owner === undefined) {
        return { type: 'unresolved', nodeId: anchor.nodeId }
      }
      if (owner !== runItem) {
        return { type: 'attached', parentItemId: owner }
      }
      cursor = messagesById.get(cursor)?.parentId ?? null
    }
    return { type: 'root' }
  }
}

export function itemIdForHead(
  model: SessionTreeModel,
  head: SelectedHead
): string | null {
  if (head === null) return null
  return head.type === 'node'
    ? (model.ownerByNodeId.get(head.nodeId) ?? null)
    : model.itemById.has(runItemId(head.runId))
      ? runItemId(head.runId)
      : null
}

export function pathItemIdsForHead(
  model: SessionTreeModel,
  head: SelectedHead
): ReadonlySet<string> {
  const path = new Set<string>()
  let cursor = itemIdForHead(model, head)
  while (cursor !== null && !path.has(cursor)) {
    path.add(cursor)
    cursor = model.parentByItemId.get(cursor) ?? null
  }
  return path
}

export function headForSessionTreeItem(item: SessionTreeItem): SelectedHead {
  if (item.type === 'active-run') {
    return {
      type: 'run',
      runId: item.run.runId,
      baseNodeId: item.run.baseNodeId,
    }
  }
  return {
    type: 'node',
    nodeId: item.compactRange.endNodeId,
  }
}

export function compactRangeForHead(
  model: SessionTreeModel,
  itemId: string,
  head: SelectedHead
): SessionTreeNodeGroup['compactRange'] | null {
  const item = model.itemById.get(itemId)
  if (!item || item.type !== 'node-group') return null
  if (
    head?.type === 'node' &&
    model.ownerByNodeId.get(head.nodeId) === item.id
  ) {
    return {
      startNodeId: item.compactRange.startNodeId,
      endNodeId: head.nodeId,
    }
  }
  return item.compactRange
}

function runMessageLeaves(
  messages: ReadonlyArray<MessageNode>,
  messagesById: ReadonlyMap<string, MessageNode>,
  childrenByParent: ReadonlyMap<string | null, ReadonlyArray<MessageNode>>,
  run: ActiveRunSummary,
  include: (message: MessageNode) => boolean
): ReadonlyArray<MessageNode> {
  const runMessages = messages.filter(
    (message) =>
      message.runId === run.runId &&
      include(message) &&
      isDescendantOrSame(messagesById, message.id, run.baseNodeId)
  )
  const runMessageIds = new Set(runMessages.map((message) => message.id))
  return runMessages.filter(
    (message) =>
      !(childrenByParent.get(message.id) ?? []).some((child) =>
        runMessageIds.has(child.id)
      )
  )
}

function findToolExchangeEdges(
  messages: ReadonlyArray<MessageNode>,
  childrenByParent: ReadonlyMap<string | null, ReadonlyArray<MessageNode>>,
  runAnchorsByNodeId: ReadonlySet<string>
) {
  const edges = new Set<string>()
  for (const message of messages) {
    const pending = new Set(assistantToolCalls(message).map((call) => call.id))
    if (pending.size === 0) continue

    let cursor = message
    while (pending.size > 0 && !runAnchorsByNodeId.has(cursor.id)) {
      const children = childrenByParent.get(cursor.id) ?? []
      if (children.length !== 1) break
      const child = children[0]
      if (!child || !isToolMessage(child)) break
      const matchingResultIds = toolResultIds(child).filter((id) =>
        pending.has(id)
      )
      if (matchingResultIds.length === 0) break
      edges.add(edgeId(cursor.id, child.id))
      for (const id of matchingResultIds) pending.delete(id)
      cursor = child
    }
  }
  return edges
}

function sameAgentRun(parent: MessageNode, child: MessageNode) {
  return (
    parent.runId !== null &&
    parent.runId === child.runId &&
    isAgentStep(parent) &&
    isAgentStep(child)
  )
}

function isAgentStep(message: MessageNode) {
  return isAssistantMessage(message) || isToolMessage(message)
}

function isPrompt(message: MessageNode) {
  return message.encoded.role === 'system' || message.encoded.role === 'user'
}

function isAssistantMessage(message: MessageNode) {
  return message.kind === 'message' && message.encoded.role === 'assistant'
}

function isToolMessage(message: MessageNode) {
  return message.kind === 'message' && message.encoded.role === 'tool'
}

function assistantToolCalls(
  message: MessageNode
): ReadonlyArray<ToolCallSummary> {
  if (!isAssistantMessage(message)) return []
  const content = message.encoded.content
  if (!Array.isArray(content)) return []
  return content
    .filter((part) => part.type === 'tool-call')
    .map((part) => ({ id: part.id, name: part.name, icon: part.header?.icon }))
}

function toolResultIds(message: MessageNode): ReadonlyArray<string> {
  if (message.kind !== 'message' || message.encoded.role !== 'tool') return []
  return message.encoded.content
    .filter((part) => part.type === 'tool-result')
    .map((part) => part.id)
}

function isDescendantOrSame(
  messagesById: ReadonlyMap<string, MessageNode>,
  nodeId: string,
  ancestorId: string | null
) {
  if (ancestorId === null) return true
  const seen = new Set<string>()
  let cursor: string | null = nodeId
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = messagesById.get(cursor)?.parentId ?? null
  }
  return false
}

const edgeId = (parentId: string, childId: string) =>
  `${parentId}\u0000${childId}`
