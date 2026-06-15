import { untrack } from 'svelte'
import { connectionsStore } from '$lib/stores/connections.svelte.js'
import { messagesStore } from '$lib/stores/messages.svelte.js'
import { sessionStore } from '$lib/stores/sessions.svelte.js'
import type { MessageNode } from '$lib/types.js'
import {
  readSelectedHead,
  selectedHeadChangedEvent,
  selectedHeadStorageKey as makeSelectedHeadStorageKey,
  writeSelectedHead,
  type SelectedHead,
  type SelectedHeadChangedDetail,
} from '$lib/selected-head-storage.js'

export class SessionSelectedHeadController {
  selectedHead: SelectedHead = $state(null)
  private initializedSelectedHeadKey: string | null = $state(null)

  get selectedHeadStorageKey() {
    return makeSelectedHeadStorageKey(
      connectionsStore.activeConnection?.id,
      this.sessionId()
    )
  }

  readonly renderHead = $derived.by(() =>
    resolveRenderHead(messagesStore.messages, this.selectedHead, (runId) =>
      sessionStore.isRunActive(runId)
    )
  )

  readonly selectedBaseNodeId = $derived.by(() =>
    this.renderHead?.type === 'node'
      ? this.renderHead.nodeId
      : this.renderHead?.type === 'run'
        ? this.renderHead.baseNodeId
        : null
  )

  readonly selectedAfterRunId = $derived.by(() =>
    this.renderHead?.type === 'run' ? this.renderHead.runId : null
  )

  readonly visibleMessages = $derived.by(() =>
    selectedMessages(messagesStore.messages, this.renderHead)
  )

  constructor(private readonly sessionId: () => string) {
    $effect(() => {
      if (typeof window === 'undefined') return

      const handler = (event: Event) => {
        if (!(event instanceof CustomEvent)) return

        const detail: SelectedHeadChangedDetail | undefined = event.detail
        if (!detail || detail.key !== this.selectedHeadStorageKey) return
        this.selectedHead = detail.head
        this.initializedSelectedHeadKey = this.selectedHeadStorageKey
      }

      window.addEventListener(selectedHeadChangedEvent, handler)
      return () => window.removeEventListener(selectedHeadChangedEvent, handler)
    })

    $effect(() => {
      const key = this.selectedHeadStorageKey
      const messages = messagesStore.messages
      if (!messagesStore.loaded) return

      const ids = new Set(messages.map((message) => message.id))

      if (this.initializedSelectedHeadKey !== key) {
        const stored = readSelectedHead(key)
        const latest = latestPersistedNodeId(messages)
        const fallback: SelectedHead =
          latest === null ? null : { type: 'node', nodeId: latest }
        const next =
          stored.exists && isStoredHeadValid(stored.value, ids)
            ? stored.value
            : fallback

        this.selectedHead = next
        this.initializedSelectedHeadKey = key
        if (!stored.exists) writeSelectedHead(key, next)
        return
      }

      if (
        this.selectedHead?.type === 'node' &&
        !ids.has(this.selectedHead.nodeId)
      ) {
        const latest = latestPersistedNodeId(messages)
        this.setSelectedHead(
          latest === null ? null : { type: 'node', nodeId: latest }
        )
      }
    })

    $effect(() => {
      const runStart = sessionStore.latestRunStart
      if (runStart === null || runStart.sessionId !== this.sessionId()) return

      untrack(() => {
        if (
          this.selectedHead?.type === 'run' &&
          this.selectedHead.runId === runStart.runId
        ) {
          return
        }

        if (
          this.renderHead?.type !== 'node' ||
          this.renderHead.nodeId !== runStart.baseNodeId
        ) {
          return
        }

        this.setSelectedHead({
          type: 'run',
          runId: runStart.runId,
          baseNodeId: runStart.baseNodeId,
        })
      })
    })

    $effect(() => {
      const head = this.renderHead
      messagesStore.selectRunStream(
        this.sessionId(),
        head?.type === 'run' ? head.runId : null,
        head?.type === 'run' ? head.baseNodeId : null
      )
    })
  }

  setSelectedHead(head: SelectedHead) {
    this.selectedHead = head
    writeSelectedHead(this.selectedHeadStorageKey, head)
  }
}

function isStoredHeadValid(head: SelectedHead, ids: ReadonlySet<string>) {
  return (
    head === null ||
    (head.type === 'node' && ids.has(head.nodeId)) ||
    (head.type === 'run' &&
      (head.baseNodeId === null || ids.has(head.baseNodeId)))
  )
}

function isOptimisticNode(message: MessageNode) {
  return message.id.startsWith('optimistic-')
}

function latestPersistedNodeId(
  messages: ReadonlyArray<MessageNode>
): string | null {
  return (
    messages.toReversed().find((message) => !isOptimisticNode(message))?.id ??
    null
  )
}

function selectedMessagePath(
  messages: ReadonlyArray<MessageNode>,
  headId: string | null
): ReadonlyArray<MessageNode> {
  if (headId === null) return []

  const byId = new Map(messages.map((message) => [message.id, message]))
  const path: MessageNode[] = []
  const seen = new Set<string>()
  let cursor: string | null = headId

  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const message = byId.get(cursor)
    if (!message) return []
    path.push(message)
    cursor = message.parentId
  }

  return path.reverse()
}

function resolveRenderHead(
  messages: ReadonlyArray<MessageNode>,
  head: SelectedHead,
  isRunActive: (runId: string) => boolean
): SelectedHead {
  if (head?.type !== 'run' || isRunActive(head.runId)) return head

  const finalNode = finalPersistedRunNode(messages, head.runId, head.baseNodeId)
  return finalNode ? { type: 'node', nodeId: finalNode.id } : head
}

function selectedMessages(
  messages: ReadonlyArray<MessageNode>,
  head: SelectedHead
): ReadonlyArray<MessageNode> {
  if (head === null) return []
  if (head.type === 'node') return selectedMessagePath(messages, head.nodeId)

  return [
    ...selectedMessagePath(messages, head.baseNodeId),
    ...messages.filter((message) => message.runId === head.runId),
  ]
}

function isDescendantOrSame(
  messages: ReadonlyArray<MessageNode>,
  nodeId: string,
  ancestorId: string | null
) {
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

function finalPersistedRunNode(
  messages: ReadonlyArray<MessageNode>,
  runId: string,
  baseNodeId: string | null
): MessageNode | null {
  const runMessages = messages.filter(
    (message) => message.runId === runId && !isOptimisticNode(message)
  )
  const hasGeneratedOutput = runMessages.some(
    (message) =>
      message.encoded.role === 'assistant' ||
      message.encoded.role === 'tool' ||
      message.encoded.role === 'system'
  )
  if (!hasGeneratedOutput) return null

  const runIds = new Set(runMessages.map((message) => message.id))
  const parentIds = new Set(
    runMessages
      .map((message) => message.parentId)
      .filter((id): id is string => id !== null && runIds.has(id))
  )

  return (
    runMessages
      .toReversed()
      .find(
        (message) =>
          !parentIds.has(message.id) &&
          isDescendantOrSame(messages, message.id, baseNodeId)
      ) ?? null
  )
}
