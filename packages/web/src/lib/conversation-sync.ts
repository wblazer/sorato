import { Equal } from 'effect'
import type { ContentEvent, ConversationSnapshot } from '@sorato/api'
import type { MessageNode, MessagePart } from '$lib/types.js'

export interface DurableNodeBatch {
  readonly sequence: number
  readonly runId: string
  readonly nodes: ReadonlyArray<MessageNode>
}

export interface ConversationSyncState {
  readonly sequence: number
  readonly nodes: ReadonlyArray<MessageNode>
}

export interface StreamContentState {
  readonly events: ContentEvent[]
  readonly parts: MessagePart[]
  readonly acknowledgedThroughEventId: number
}

export const emptyStreamContentState: StreamContentState = {
  events: [],
  parts: [],
  acknowledgedThroughEventId: 0,
}

const isOptimisticNode = (node: MessageNode): boolean =>
  node.id.startsWith('optimistic-')

const committedUserRunIds = (
  nodes: ReadonlyArray<MessageNode>
): ReadonlySet<string> =>
  new Set(
    nodes.flatMap((node) =>
      node.runId !== null && node.encoded.role === 'user' ? [node.runId] : []
    )
  )

export const upsertConversationNodes = (
  current: ReadonlyArray<MessageNode>,
  incoming: ReadonlyArray<MessageNode>
): ReadonlyArray<MessageNode> => {
  if (incoming.length === 0) return current

  const committedUserRuns = committedUserRunIds(incoming)
  const next = current.filter(
    (node) =>
      !(
        isOptimisticNode(node) &&
        node.runId !== null &&
        committedUserRuns.has(node.runId)
      )
  )
  const indexes = new Map(next.map((node, index) => [node.id, index]))

  for (const node of incoming) {
    const index = indexes.get(node.id)
    if (index === undefined) {
      indexes.set(node.id, next.length)
      next.push(node)
    } else if (!Equal.equals(next[index], node)) {
      next[index] = node
    }
  }

  return next.length === current.length &&
    next.every((node, index) => node === current[index])
    ? current
    : next
}

export const applyDurableNodeBatch = (
  state: ConversationSyncState,
  batch: DurableNodeBatch
): ConversationSyncState => {
  if (batch.sequence <= state.sequence) return state
  return {
    sequence: batch.sequence,
    nodes: upsertConversationNodes(state.nodes, batch.nodes),
  }
}

export const applyConversationSnapshot = (
  current: ConversationSyncState,
  snapshot: ConversationSnapshot,
  bufferedBatches: ReadonlyArray<DurableNodeBatch>
): ConversationSyncState => {
  const existingById = new Map(current.nodes.map((node) => [node.id, node]))
  const snapshotNodes = snapshot.nodes.map((node) => {
    const existing = existingById.get(node.id)
    return existing !== undefined && Equal.equals(existing, node)
      ? existing
      : node
  })
  let next: ConversationSyncState = {
    sequence: snapshot.sequence,
    nodes: snapshotNodes,
  }

  for (const batch of bufferedBatches) {
    next = applyDurableNodeBatch(next, batch)
  }

  const committedRuns = committedUserRunIds(next.nodes)
  const optimisticNodes = current.nodes.filter(
    (node) =>
      isOptimisticNode(node) &&
      (node.runId === null || !committedRuns.has(node.runId))
  )
  return {
    ...next,
    nodes: upsertConversationNodes(next.nodes, optimisticNodes),
  }
}

const appendPart = (
  parts: ReadonlyArray<MessagePart>,
  part: MessagePart
): MessagePart[] => {
  const last = parts[parts.length - 1]
  if (last?.type === 'text' && part.type === 'text') {
    return [
      ...parts.slice(0, -1),
      { type: 'text', text: last.text + part.text },
    ]
  }
  if (last?.type === 'reasoning' && part.type === 'reasoning') {
    return [
      ...parts.slice(0, -1),
      { type: 'reasoning', text: last.text + part.text },
    ]
  }
  return [...parts, part]
}

const contentEventPart = (event: ContentEvent): MessagePart => {
  switch (event._tag) {
    case 'TextDelta':
      return { type: 'text', text: event.delta }
    case 'ReasoningDelta':
      return { type: 'reasoning', text: event.delta }
    case 'ToolCall':
      return {
        type: 'tool-call',
        id: event.id,
        name: event.name,
        params: event.params,
        header: event.header,
      }
    case 'ToolResult':
      return {
        type: 'tool-result',
        id: event.id,
        name: event.name,
        result: event.result,
        header: event.header,
        bodyDisplay: event.bodyDisplay,
        isFailure: event.isFailure,
      }
  }
}

export const contentEventsToParts = (
  events: ReadonlyArray<ContentEvent>
): MessagePart[] =>
  events.reduce<MessagePart[]>(
    (parts, event) => appendPart(parts, contentEventPart(event)),
    []
  )

export const appendContentEvent = (
  state: StreamContentState,
  event: ContentEvent
): StreamContentState => {
  if (
    event.eventId <= state.acknowledgedThroughEventId ||
    state.events.some((existing) => existing.eventId === event.eventId)
  )
    return state

  const events = [...state.events, event].toSorted(
    (left, right) => left.eventId - right.eventId
  )
  return {
    ...state,
    events,
    parts: contentEventsToParts(events),
  }
}

export const acknowledgeContentThrough = (
  state: StreamContentState,
  eventId: number
): StreamContentState => {
  if (eventId <= state.acknowledgedThroughEventId) return state
  const events = state.events.filter((event) => event.eventId > eventId)
  return {
    events,
    parts: contentEventsToParts(events),
    acknowledgedThroughEventId: eventId,
  }
}
