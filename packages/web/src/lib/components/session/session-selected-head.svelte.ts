import { untrack } from 'svelte'
import { connectionsStore } from '$lib/stores/connections.svelte.js'
import { messagesStore } from '$lib/stores/messages.svelte.js'
import { sessionStore } from '$lib/stores/sessions.svelte.js'
import type { MessageNode } from '$lib/types.js'
import {
  completedRunHead,
  isDescendantOrSame,
  reconcileSelectedHead,
  renderHeadWhileNodePending,
  shouldResolveRunHead,
} from './selected-head-reconciliation.js'
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
  private pendingNodeFallbackHead: SelectedHead = $state(null)

  get selectedHeadStorageKey() {
    return makeSelectedHeadStorageKey(
      connectionsStore.activeConnectionScopeId,
      this.sessionId(),
      this.tabId()
    )
  }

  readonly renderHead = $derived.by(() => {
    const messages = messagesStore.messagesForTab(this.tabId())
    const ids = new Set(messages.map((message) => message.id))
    const renderHead = renderHeadWhileNodePending(
      this.selectedHead,
      ids,
      this.pendingNodeFallbackHead
    )
    return resolveRenderHead(
      messages,
      renderHead,
      (runId) => sessionStore.isRunActive(runId),
      (runId) => messagesStore.durableRunFocusForTab(this.tabId(), runId)
    )
  })

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
    selectedMessages(
      messagesStore.messagesForTab(this.tabId()),
      this.renderHead
    )
  )

  constructor(
    private readonly tabId: () => string,
    private readonly sessionId: () => string,
    private readonly isActive: () => boolean = () => true
  ) {
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
      const messages = messagesStore.messagesForTab(this.tabId())
      if (!messagesStore.loadedForTab(this.tabId())) return

      const ids = new Set(messages.map((message) => message.id))

      if (this.initializedSelectedHeadKey !== key) {
        const stored = readSelectedHead(key)
        const next = stored.exists
          ? reconcileSelectedHead(stored.value, ids, false)
          : null

        this.selectedHead = next
        this.pendingNodeFallbackHead = null
        this.initializedSelectedHeadKey = key
        if (!stored.exists) writeSelectedHead(key, next)
        return
      }

      const reconciledHead = reconcileSelectedHead(this.selectedHead, ids, true)
      if (reconciledHead !== this.selectedHead) {
        this.setSelectedHead(reconciledHead)
      }
      if (
        this.selectedHead?.type !== 'node' ||
        ids.has(this.selectedHead.nodeId)
      ) {
        this.pendingNodeFallbackHead = null
      }

      const selectedRun =
        this.selectedHead?.type === 'run' ? this.selectedHead : null
      if (selectedRun === null) return
      const durableFocusNodeId = messagesStore.durableRunFocusForTab(
        this.tabId(),
        selectedRun.runId
      )
      if (
        !shouldResolveRunHead(
          messages,
          selectedRun.runId,
          sessionStore.isRunActive(selectedRun.runId),
          durableFocusNodeId !== undefined
        )
      )
        return

      this.setSelectedHead(
        completedRunHead(
          messages,
          selectedRun.runId,
          selectedRun.baseNodeId,
          durableFocusNodeId
        )
      )
    })

    $effect(() => {
      const runStart = sessionStore.latestRunStart
      if (runStart === null || runStart.sessionId !== this.sessionId()) return
      if (
        runStart.visibility === 'background' &&
        runStart.parentRunId !== undefined
      )
        return

      untrack(() => {
        if (
          this.selectedHead?.type === 'run' &&
          this.selectedHead.runId === runStart.runId
        ) {
          if (this.selectedHead.baseNodeId !== runStart.baseNodeId) {
            this.setSelectedHead({
              type: 'run',
              runId: runStart.runId,
              baseNodeId: runStart.baseNodeId,
            })
          }
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
      if (!this.isActive()) return

      const head = this.renderHead
      messagesStore.selectRunStream(
        this.tabId(),
        this.sessionId(),
        head?.type === 'run' ? head.runId : null,
        head?.type === 'run' ? head.baseNodeId : null
      )
    })
  }

  setSelectedHead(head: SelectedHead) {
    const ids = new Set(
      messagesStore.messagesForTab(this.tabId()).map((message) => message.id)
    )
    this.pendingNodeFallbackHead =
      head?.type === 'node' && !ids.has(head.nodeId) ? this.renderHead : null
    this.selectedHead = head
    writeSelectedHead(this.selectedHeadStorageKey, head)
  }
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
  isRunActive: (runId: string) => boolean,
  durableRunFocus: (runId: string) => string | null | undefined
): SelectedHead {
  const durableFocusNodeId =
    head?.type === 'run' ? durableRunFocus(head.runId) : undefined
  if (
    head?.type !== 'run' ||
    !shouldResolveRunHead(
      messages,
      head.runId,
      isRunActive(head.runId),
      durableFocusNodeId !== undefined
    )
  )
    return head

  return completedRunHead(
    messages,
    head.runId,
    head.baseNodeId,
    durableFocusNodeId
  )
}

function selectedMessages(
  messages: ReadonlyArray<MessageNode>,
  head: SelectedHead
): ReadonlyArray<MessageNode> {
  if (head === null) return []
  if (head.type === 'node') return selectedMessagePath(messages, head.nodeId)

  const path = selectedMessagePath(messages, head.baseNodeId)
  const pathIds = new Set(path.map((message) => message.id))
  const runMessages = messages.filter(
    (message) =>
      message.runId === head.runId &&
      !pathIds.has(message.id) &&
      isDescendantOrSame(messages, message.id, head.baseNodeId)
  )

  return [...path, ...runMessages]
}
