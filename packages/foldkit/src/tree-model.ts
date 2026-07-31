import type { MessageNodeResponse } from '@sorato/api'

export type TreeTone = 'user' | 'assistant' | 'tool' | 'system' | 'summary'
export type BranchConnector = 'first' | 'middle' | 'last' | null

export interface TreeItem {
  readonly id: string
  readonly nodeIds: ReadonlyArray<string>
  readonly message: MessageNodeResponse
  readonly displayMessage: MessageNodeResponse
  readonly tone: TreeTone
  readonly combinedRun: boolean
  readonly toolCount: number
  readonly compactStartNodeId: string
  readonly compactEndNodeId: string
  readonly children: ReadonlyArray<TreeItem>
}

export interface TreeModel {
  readonly roots: ReadonlyArray<TreeItem>
  readonly itemById: ReadonlyMap<string, TreeItem>
  readonly ownerByNodeId: ReadonlyMap<string, string>
  readonly parentByItemId: ReadonlyMap<string, string>
}

export interface TreeRow {
  readonly item: TreeItem
  readonly depth: number
  readonly connector: BranchConnector
  readonly continuingLevels: ReadonlySet<number>
  readonly selected: boolean
  readonly inSelectedPath: boolean
  readonly parentConnector: boolean
  readonly childConnector: boolean
  readonly activeParentConnector: boolean
  readonly activeChildConnector: boolean
}

/**
 * The snapshot API does not expose the Svelte ActiveRunSummary fields
 * (kind, baseNodeId, parentRunId and visibility), nor presentation icon names.
 * Consequently active-run attachment/diagnostics and custom icons cannot be
 * represented here. Durable message topology, run grouping and summary kind are
 * fully represented by MessageNodeResponse.
 */
export const buildTreeModel = (
  messages: ReadonlyArray<MessageNodeResponse>,
  groupAgentSteps = true
): TreeModel => {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const childrenByParent = new Map<string | null, Array<MessageNodeResponse>>()
  for (const message of messages) {
    const children = childrenByParent.get(message.parentId) ?? []
    children.push(message)
    childrenByParent.set(message.parentId, children)
  }

  const successor = new Map<string, string>()
  const predecessor = new Set<string>()
  for (const message of messages) {
    const children = childrenByParent.get(message.id) ?? []
    const child = children[0]
    if (
      children.length === 1 &&
      child !== undefined &&
      message.runId !== null &&
      message.runId === child.runId &&
      isAgentStep(message) &&
      isAgentStep(child) &&
      (groupAgentSteps || isToolExchange(message, child))
    ) {
      successor.set(message.id, child.id)
      predecessor.add(child.id)
    }
  }

  const mutable = new Map<string, TreeItem & { children: Array<TreeItem> }>()
  const ownerByNodeId = new Map<string, string>()
  for (const start of messages) {
    if (predecessor.has(start.id)) continue
    const grouped: Array<MessageNodeResponse> = []
    let cursor: MessageNodeResponse | undefined = start
    while (cursor !== undefined) {
      grouped.push(cursor)
      const next = successor.get(cursor.id)
      cursor = next === undefined ? undefined : byId.get(next)
    }
    const end = grouped.at(-1) ?? start
    const id = `node:${start.id}`
    for (const node of grouped) ownerByNodeId.set(node.id, id)
    mutable.set(id, {
      id,
      nodeIds: grouped.map((node) => node.id),
      message: start,
      displayMessage:
        [...grouped].reverse().find((node) => node.encoded.role !== 'tool') ??
        end,
      tone: start.kind === 'summary' ? 'summary' : start.encoded.role,
      combinedRun: grouped.length > 1,
      toolCount: grouped.reduce(
        (count, node) => count + toolCallCount(node),
        0
      ),
      compactStartNodeId: start.id,
      compactEndNodeId: end.id,
      children: [],
    })
  }

  const parentByItemId = new Map<string, string>()
  for (const message of messages) {
    if (message.parentId === null) continue
    const parent = ownerByNodeId.get(message.parentId)
    const child = ownerByNodeId.get(message.id)
    if (parent === undefined || child === undefined || parent === child)
      continue
    if (parentByItemId.has(child)) continue
    parentByItemId.set(child, parent)
    const parentItem = mutable.get(parent)
    const childItem = mutable.get(child)
    if (parentItem !== undefined && childItem !== undefined)
      parentItem.children.push(childItem)
  }
  return {
    roots: [...mutable.values()].filter((item) => !parentByItemId.has(item.id)),
    itemById: mutable,
    ownerByNodeId,
    parentByItemId,
  }
}

export const selectedPathIds = (model: TreeModel, nodeId: string | null) => {
  const path = new Set<string>()
  let cursor = nodeId === null ? undefined : model.ownerByNodeId.get(nodeId)
  while (cursor !== undefined && !path.has(cursor)) {
    path.add(cursor)
    cursor = model.parentByItemId.get(cursor)
  }
  return path
}

export const flattenTree = (
  model: TreeModel,
  selectedNodeId: string | null
): ReadonlyArray<TreeRow> => {
  const path = selectedPathIds(model, selectedNodeId)
  const selected =
    selectedNodeId === null
      ? undefined
      : model.ownerByNodeId.get(selectedNodeId)
  const rows: Array<TreeRow> = []
  const visit = (
    item: TreeItem,
    depth: number,
    connector: BranchConnector,
    continuing: ReadonlySet<number>
  ) => {
    rows.push({
      item,
      depth,
      connector,
      continuingLevels: continuing,
      selected: item.id === selected,
      inSelectedPath: path.has(item.id),
      parentConnector: model.parentByItemId.has(item.id),
      childConnector: item.children.length > 0,
      activeParentConnector:
        path.has(item.id) && path.has(model.parentByItemId.get(item.id) ?? ''),
      activeChildConnector:
        path.has(item.id) && item.children.some((child) => path.has(child.id)),
    })
    const children = [...item.children].sort(
      (a, b) => Number(path.has(b.id)) - Number(path.has(a.id))
    )
    children.forEach((child, index) => {
      const next = new Set(continuing)
      if (children.length > 1 && index < children.length - 1) next.add(depth)
      else next.delete(depth)
      const childConnector =
        children.length < 2
          ? null
          : index === 0
            ? 'first'
            : index === children.length - 1
              ? 'last'
              : 'middle'
      visit(child, depth + (children.length > 1 ? 1 : 0), childConnector, next)
    })
  }
  const roots = [...model.roots].sort(
    (a, b) => Number(path.has(b.id)) - Number(path.has(a.id))
  )
  roots.forEach((root) => visit(root, 0, null, new Set()))
  return rows
}

export const isNodeInRange = (
  orderedIds: ReadonlyArray<string>,
  start: string | null,
  end: string | null,
  id: string
) => {
  const a = start === null ? -1 : orderedIds.indexOf(start)
  const b = end === null ? -1 : orderedIds.indexOf(end)
  const index = orderedIds.indexOf(id)
  return a >= 0 && b >= 0 && index >= Math.min(a, b) && index <= Math.max(a, b)
}

const isAgentStep = (node: MessageNodeResponse) =>
  node.kind === 'message' &&
  (node.encoded.role === 'assistant' || node.encoded.role === 'tool')

const isToolExchange = (
  message: MessageNodeResponse,
  child: MessageNodeResponse
): boolean => {
  if (message.encoded.role !== 'assistant' || child.encoded.role !== 'tool')
    return false
  const content = message.encoded.content
  return (
    Array.isArray(content) && content.some((part) => part.type === 'tool-call')
  )
}

const toolCallCount = (message: MessageNodeResponse): number => {
  const content = message.encoded.content
  return Array.isArray(content)
    ? content.filter((part) => part.type === 'tool-call').length
    : 0
}
