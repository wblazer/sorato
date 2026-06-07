<script lang="ts">
      import { tick } from 'svelte'
      import { messagesStore } from '$lib/stores/messages.svelte.js'
      import { modelsStore } from '$lib/stores/models.svelte.js'
      import { projectStore } from '$lib/stores/projects.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
      import { connectionsStore } from '$lib/stores/connections.svelte.js'
      import type { MessageNode, ModelCall } from '$lib/types.js'
      import {
        persistedSources,
        projectTranscript,
        type TranscriptItem,
      } from '$lib/transcript.js'
      import MessageBubble from './message-bubble.svelte'
      import QueuedMessageBubble from './queued-message-bubble.svelte'
      import StreamingIndicator from './streaming-indicator.svelte'
      import SessionTokenUsage from './session-token-usage.svelte'
      import Composer from './composer.svelte'
      import { Button } from '$lib/components/ui/button/index.js'
      import * as Item from '$lib/components/ui/item/index.js'
      import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
      import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
      import {
        readSelectedHead,
        selectedHeadChangedEvent,
        selectedHeadStorageKey as makeSelectedHeadStorageKey,
        writeSelectedHead,
        type SelectedHead,
        type SelectedHeadChangedDetail,
      } from '$lib/selected-head-storage.js'

      let { sessionId, title }: { sessionId: string; title: string | null } =
        $props()

      let messagesContainer: HTMLElement | null = $state(null)
      let messagesContent: HTMLDivElement | undefined = $state()
      let isAtBottom = $state(true)
      let shouldAutoScroll = $state(true)
      let autoScrollTop: number | undefined
      let resizeObserver: ResizeObserver | undefined
      let selectedHead: SelectedHead = $state(null)
      let initializedSelectedHeadKey: string | null = $state(null)

      const bottomThreshold = 8

      // Running state is derived from the session store — the single source
      // of truth. The messages store only tracks streaming *content*.
      const isRunning = $derived(sessionStore.isRunning(sessionId))
      const isStopping = $derived(sessionStore.isStopping(sessionId))
      const queuedMessages = $derived(sessionStore.queuedMessagesFor(sessionId))
      const sessionError = $derived(sessionStore.sessionError(sessionId))
      const selectedSession = $derived(
        sessionStore.sessions.find((item) => item.id === sessionId) ?? null
      )
      const projectName = $derived.by(() => {
        const project = projectStore.getProject(selectedSession?.projectId ?? null)
        return project?.name ?? null
      })
      const selectedHeadStorageKey = $derived(
        makeSelectedHeadStorageKey(connectionsStore.activeConnection?.id, sessionId)
      )

      const selectedBaseNodeId = $derived.by(() =>
        selectedHead?.type === 'node'
          ? selectedHead.nodeId
          : selectedHead?.type === 'run'
            ? selectedHead.baseNodeId
            : null
      )
      const selectedAfterRunId = $derived.by(() =>
        selectedHead?.type === 'run' ? selectedHead.runId : null
      )

      const visibleMessages = $derived.by(() =>
        selectedMessages(messagesStore.messages, selectedHead)
      )

      const persistedTranscriptItems = $derived.by(() =>
        projectTranscript(persistedSources(visibleMessages), {
          pretty: clientSettingsStore.prettyTranscript,
        })
      )

      type MessageRenderBlock = {
        readonly key: string
        readonly message: MessageNode
        readonly items: ReadonlyArray<TranscriptItem>
        readonly modelCall: ModelCall | null
      }

      const transcriptSourceMessage = (
        item: TranscriptItem
      ): MessageNode | null => {
        const source = item.type === 'combined-tool' ? item.callSource : item.source
        return source.type === 'persisted' ? source.message : null
      }

      const transcriptItemsForMessages = (
        messages: ReadonlyArray<MessageNode>
      ): ReadonlyArray<TranscriptItem> =>
        persistedTranscriptItems.filter((item) => {
          const message = transcriptSourceMessage(item)
          return message !== null && messages.includes(message)
        })

      function latestNodeId(messages: ReadonlyArray<MessageNode>): string | null {
        return messages.at(-1)?.id ?? null
      }

      function isOptimisticNode(message: MessageNode) {
        return message.id.startsWith('optimistic-')
      }

      function latestPersistedNodeId(
        messages: ReadonlyArray<MessageNode>
      ): string | null {
        return messages.toReversed().find((message) => !isOptimisticNode(message))?.id ?? null
      }

      function setSelectedHead(head: SelectedHead) {
        selectedHead = head
        writeSelectedHead(selectedHeadStorageKey, head)
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

      const messageBlocks = $derived.by((): ReadonlyArray<MessageRenderBlock> => {
        const blocks: MessageRenderBlock[] = []
        const messages = visibleMessages

        for (let index = 0; index < messages.length; index++) {
          const message = messages[index]

          if (message.encoded.role === 'assistant') {
            const group = [message]
            let cursor = index + 1
            while (
              cursor < messages.length &&
              (messages[cursor].encoded.role === 'assistant' ||
                messages[cursor].encoded.role === 'tool')
            ) {
              group.push(messages[cursor])
              cursor++
            }

            blocks.push({
              key: group.map((groupMessage) => groupMessage.id).join(':'),
              message,
              items: transcriptItemsForMessages(group),
              modelCall:
                group
                  .toReversed()
                  .find((groupMessage) => groupMessage.modelCall !== null)?.modelCall ??
                null,
            })
            index = cursor - 1
            continue
          }

          blocks.push({
            key: message.id,
            message,
            items: transcriptItemsForMessages([message]),
            modelCall: message.modelCall,
          })
        }

        return blocks
      })

      function updateScrollState() {
        if (!messagesContainer) return

        const distanceFromBottom =
          messagesContainer.scrollHeight -
          messagesContainer.scrollTop -
          messagesContainer.clientHeight

        isAtBottom = distanceFromBottom <= bottomThreshold
      }

      function handleScroll() {
        updateScrollState()

        if (isAtBottom) {
          shouldAutoScroll = true
          autoScrollTop = undefined
          return
        }

        if (
          shouldAutoScroll &&
          autoScrollTop !== undefined &&
          messagesContainer &&
          Math.abs(messagesContainer.scrollTop - autoScrollTop) < 2
        ) {
          return
        }

        shouldAutoScroll = isAtBottom
      }

      function handleWheel(event: WheelEvent) {
        if (event.deltaY >= 0) return
        shouldAutoScroll = false
        autoScrollTop = undefined
      }

      function scrollToBottom() {
        if (!messagesContainer) return
        autoScrollTop = Math.max(
          0,
          messagesContainer.scrollHeight - messagesContainer.clientHeight
        )
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight })
        isAtBottom = true
        updateScrollState()
      }

      function jumpToLatest() {
        shouldAutoScroll = true
        scrollToBottom()
      }

      function scrollToLatestAfterRender() {
        shouldAutoScroll = true

        tick().then(() =>
          requestAnimationFrame(() => {
            scrollToBottom()
            updateScrollState()
          })
        )
      }

      $effect(() => {
        if (messagesStore.currentSessionId !== sessionId) {
          void messagesStore.loadMessages(sessionId)
        }
      })

      $effect(() => {
        if (!messagesContent || typeof ResizeObserver === 'undefined') return

        resizeObserver?.disconnect()
        resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(() => {
            if (shouldAutoScroll) scrollToBottom()
            updateScrollState()
          })
        })
        resizeObserver.observe(messagesContent)

        return () => {
          resizeObserver?.disconnect()
          resizeObserver = undefined
        }
      })

      $effect(() => {
        messagesStore.messages.length
        messagesStore.streamingParts
        queuedMessages.length

        tick().then(() =>
          requestAnimationFrame(() => {
            if (shouldAutoScroll) scrollToBottom()
            updateScrollState()
          })
        )
      })

      $effect(() => {
        if (typeof window === 'undefined') return

        const handler = (event: Event) => {
          const detail = (event as CustomEvent<SelectedHeadChangedDetail>).detail
          if (!detail || detail.key !== selectedHeadStorageKey) return
          selectedHead = detail.head
          initializedSelectedHeadKey = selectedHeadStorageKey
        }

        window.addEventListener(selectedHeadChangedEvent, handler)
        return () => window.removeEventListener(selectedHeadChangedEvent, handler)
      })

      $effect(() => {
        const key = selectedHeadStorageKey
        const messages = messagesStore.messages
        if (!messagesStore.loaded) return

        const ids = new Set(messages.map((message) => message.id))

        if (initializedSelectedHeadKey !== key) {
          const stored = readSelectedHead(key)
          const latest = latestPersistedNodeId(messages)
          const fallback: SelectedHead =
            latest === null ? null : { type: 'node', nodeId: latest }
          const next =
            stored.exists &&
            (stored.value === null ||
              (stored.value.type === 'node' && ids.has(stored.value.nodeId)) ||
              (stored.value.type === 'run' &&
                (stored.value.baseNodeId === null ||
                  ids.has(stored.value.baseNodeId))))
              ? stored.value
              : fallback

          selectedHead = next
          initializedSelectedHeadKey = key
          if (!stored.exists) writeSelectedHead(key, next)
          return
        }

        if (
          selectedHead?.type === 'node' &&
          !ids.has(selectedHead.nodeId)
        ) {
          const latest = latestPersistedNodeId(messages)
          setSelectedHead(latest === null ? null : { type: 'node', nodeId: latest })
        }
      })

      $effect(() => {
        const activeRunId = messagesStore.activeRunId
        if (
          activeRunId === null ||
          (selectedHead?.type === 'run' && selectedHead.runId === activeRunId)
        )
          return

        const firstRunMessage = messagesStore.messages.find(
          (message) => message.runId === activeRunId
        )
        if (!firstRunMessage) return

        setSelectedHead({
          type: 'run',
          runId: activeRunId,
          baseNodeId: firstRunMessage.parentId,
        })
      })

      $effect(() => {
        const head = selectedHead
        if (head?.type !== 'run' || isRunning) return

        const finalNode = finalPersistedRunNode(
          messagesStore.messages,
          head.runId,
          head.baseNodeId
        )
        if (!finalNode) return

        setSelectedHead({ type: 'node', nodeId: finalNode.id })
      })

      function handleSend(input: string) {
        const model = modelsStore.selectedModel
        if (!model) return

        const baseNodeId = selectedBaseNodeId
        const afterRunId = selectedAfterRunId
        const wasRunning = sessionStore.isRunning(sessionId)

        scrollToLatestAfterRender()

        void sessionStore
          .runAgent(
            sessionId,
            input,
            model,
            baseNodeId,
            afterRunId,
            modelsStore.selectedOptions
          )
          .then((response) => {
            if (!response) return

            if (response.status === 'started') {
              const runHead: SelectedHead = {
                type: 'run',
                runId: response.runId,
                baseNodeId,
              }
              setSelectedHead(runHead)
            }

            if (!wasRunning) {
              // Show the user's message immediately — don't wait for the server
              // round-trip. The optimistic node is replaced on the next refresh.
              messagesStore.addOptimisticUserMessage(
                sessionId,
                input,
                baseNodeId,
                response.runId
              )
            }
          })
      }

      function handleStop() {
        sessionStore.stopAgent(sessionId)
      }

      function handleModel(value: string, modelOptions = {}) {
        modelsStore.select(value, modelOptions)
      }

      function handleAttach() {}

      function handleDismissError() {
        sessionStore.clearSessionError(sessionId)
      }

      function retryMessages() {
        void messagesStore.loadMessages(sessionId)
      }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="border-b border-border py-3.5">
    <div class="mx-auto flex w-full max-w-6xl items-center gap-2.5 px-4 sm:px-6">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h1 class="text-sm leading-tight font-semibold text-foreground">
          {title ?? 'New Session'}
        </h1>
        {#if projectName}
          <span class="text-sm leading-tight text-muted-foreground">{projectName}</span>
        {/if}
      </div>

      <SessionTokenUsage messages={visibleMessages} models={modelsStore.models} />

    </div>
  </div>

  <!-- Messages -->
  <div class="relative min-h-0 flex-1 overflow-hidden">
    <ScrollArea
      bind:viewportRef={messagesContainer}
      class="h-full"
      viewportClass="scroll-mask-y scroll-mask-y-from-98%"
      onViewportScroll={handleScroll}
      onViewportWheel={handleWheel}
    >
      {#if messagesStore.loading}
        <div
          class="mx-auto flex w-full max-w-6xl items-center justify-center p-8"
        >
          <span class="text-sm text-muted-foreground">Loading messages...</span>
        </div>
      {:else if messagesStore.error}
        <div
          class="mx-auto flex w-full max-w-6xl items-center justify-center p-8"
        >
          <Item.Root variant="danger" class="max-w-xl">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>Messages failed to load</Item.Title>
              <Item.Description>{messagesStore.error}</Item.Description>
            </Item.Content>
            <Item.Actions>
              <Button variant="outline" onclick={retryMessages}>Retry</Button>
            </Item.Actions>
          </Item.Root>
        </div>
      {:else if messagesStore.loaded || isRunning}
        <div
          bind:this={messagesContent}
          class="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-5 sm:px-6"
        >
          {#each messageBlocks as block (block.key)}
            <MessageBubble
              message={block.message}
              transcriptItems={block.items}
              modelCall={block.modelCall}
            />
          {/each}

          <StreamingIndicator parts={messagesStore.streamingParts} {isRunning} />

          {#each queuedMessages as message (message.id)}
            <QueuedMessageBubble {message} />
          {/each}
        </div>
      {/if}
    </ScrollArea>

    {#if !isAtBottom}
      <div class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
        <Button
          class="pointer-events-auto shadow-md shadow-shadow/30"
          variant="outline"
          size="sm"
          onclick={jumpToLatest}
        >
          Jump to latest
        </Button>
      </div>
    {/if}
  </div>

  <!-- Composer -->
  <Composer
    onSend={handleSend}
    onStop={handleStop}
    onAttach={handleAttach}
    onDismissStatus={handleDismissError}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={modelsStore.selectedModel}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    {isRunning}
    {isStopping}
    autoFocus
    focusKey={sessionId}
    {sessionError}
    disabled={isStopping}
  />
</div>
