<script lang="ts">
      import { onDestroy, tick } from 'svelte'
      import { get } from 'svelte/store'
      import { createVirtualizer } from '@tanstack/svelte-virtual'
      import { messagesStore } from '$lib/stores/messages.svelte.js'
      import { modelsStore } from '$lib/stores/models.svelte.js'
      import { projectStore } from '$lib/stores/projects.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
      import type { MessageNode, ModelCall } from '$lib/types.js'
      import {
        persistedSources,
        projectTranscript,
        type TranscriptItem,
      } from '$lib/transcript.js'
      import MessageBubble from './message-bubble.svelte'
      import QueuedMessageBubble from './queued-message-bubble.svelte'
      import StreamingIndicator from './streaming-indicator.svelte'
      import Composer from './composer.svelte'
      import SessionTreePanel from './session-tree-panel.svelte'
      import { Button } from '$lib/components/ui/button/index.js'
      import { Badge } from '$lib/components/ui/badge/index.js'
      import { SessionSelectedHeadController } from './session-selected-head.svelte.js'
      import * as Item from '$lib/components/ui/item/index.js'
      import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
      import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
      import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon'
      let { sessionId, title }: { sessionId: string; title: string | null } =
        $props()

      const selectedHead = new SessionSelectedHeadController(() => sessionId)
      let messagesContainer: HTMLElement | null = $state(null)
      let isAtLatest = $state(true)
      let initialScrollSessionId: string | null = null
      let accordionSessionId: string | null = $state(null)
      let accordionState = $state<Record<string, string[]>>({})
      let treePanelOpen = $state(true)
      let sessionLayout: HTMLElement | null = $state(null)
      let treePanelElement: HTMLElement | null = $state(null)
      let treePanelWidth = $state(360)
      let loadedTreePanelWidth = false
      let treeResizeCleanup: (() => void) | null = null

      const treePanelWidthStorageKey = 'sorato:session-tree-panel-width'
      const minTreePanelWidth = 260
      const maxTreePanelWidth = 1200

      // Running state is derived from the session store — the single source
      // of truth. The messages store only tracks streaming *content*.
      const isRunning = $derived(sessionStore.isRunning(sessionId))
      const isStopping = $derived(sessionStore.isStopping(sessionId))
      const queuedMessages = $derived(sessionStore.queuedMessagesFor(sessionId))
      const sessionStatus = $derived(sessionStore.sessionStatus(sessionId))
      const selectedSession = $derived(
        sessionStore.sessions.find((item) => item.id === sessionId) ?? null
      )
      const projectName = $derived.by(() => {
        const project = projectStore.getProject(selectedSession?.projectId ?? null)
        return project?.name ?? null
      })
      const visibleMessages = $derived(selectedHead.visibleMessages)

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
        readonly runId: string | null
      }

      type SessionVirtualRow =
        | {
            readonly type: 'message'
            readonly key: string
            readonly block: MessageRenderBlock
          }
        | {
            readonly type: 'streaming'
            readonly key: string
          }
        | {
            readonly type: 'queued'
            readonly key: string
            readonly message: (typeof queuedMessages)[number]
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
              runId: message.runId,
            })
            index = cursor - 1
            continue
          }

          blocks.push({
            key: message.id,
            message,
            items: transcriptItemsForMessages([message]),
            modelCall: message.modelCall,
            runId: message.runId,
          })
        }

        return blocks.map((block, index) => {
          if (block.runId === null) return block
          if (sessionStore.isRunActive(block.runId)) {
            return { ...block, modelCall: null }
          }

          const isLastBlockForRun = !blocks
            .slice(index + 1)
            .some((laterBlock) => laterBlock.runId === block.runId)
          return isLastBlockForRun ? block : { ...block, modelCall: null }
        })
      })

      const virtualRows = $derived.by((): ReadonlyArray<SessionVirtualRow> => [
        ...messageBlocks.map((block) => ({
          type: 'message' as const,
          key: `message:${block.key}`,
          block,
        })),
        ...(isRunning || messagesStore.streamingParts.length > 0
          ? [{ type: 'streaming' as const, key: 'streaming' }]
          : []),
        ...queuedMessages.map((message) => ({
          type: 'queued' as const,
          key: `queued:${message.id}`,
          message,
        })),
      ])

      const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
        count: 0,
        getScrollElement: () => messagesContainer,
        estimateSize: () => 160,
        getItemKey: (index) => virtualRows[index]?.key ?? index,
        anchorTo: 'end',
        followOnAppend: true,
        scrollEndThreshold: 80,
        overscan: 6,
        paddingStart: 20,
        paddingEnd: 20,
        gap: 12,
        onChange: (instance) => {
          isAtLatest = instance.isAtEnd(80)
        },
      })

      const virtualItems = $derived($virtualizer.getVirtualItems())

      function measureVirtualRow(node: HTMLDivElement) {
        get(virtualizer).measureElement(node)
      }

      function updateLatestState() {
        isAtLatest = get(virtualizer).isAtEnd(80)
      }

      function jumpToLatest() {
        get(virtualizer).scrollToEnd()
        updateLatestState()
      }

      function scrollToLatestAfterRender() {
        tick().then(() =>
          requestAnimationFrame(() => {
            get(virtualizer).scrollToEnd()
            updateLatestState()
          })
        )
      }

      $effect(() => {
        if (messagesStore.currentSessionId !== sessionId) {
          void messagesStore.loadMessages(sessionId)
        }
      })

      $effect(() => {
        if (accordionSessionId === sessionId) return
        accordionSessionId = sessionId
        accordionState = {}
      })

      $effect(() => {
        get(virtualizer).setOptions({
          count: virtualRows.length,
          getScrollElement: () => messagesContainer,
          estimateSize: () => 160,
          getItemKey: (index) => virtualRows[index]?.key ?? index,
          anchorTo: 'end',
          followOnAppend: true,
          scrollEndThreshold: 80,
          overscan: 6,
          paddingStart: 20,
          paddingEnd: 20,
          gap: 12,
          onChange: (instance) => {
            isAtLatest = instance.isAtEnd(80)
          },
        })
      })

      $effect(() => {
        if (messagesStore.currentSessionId !== sessionId) return
        if (messagesStore.loading || virtualRows.length === 0) return
        if (initialScrollSessionId === sessionId) return
        initialScrollSessionId = sessionId
        scrollToLatestAfterRender()
      })

      // Intentionally keep run heads as run heads after completion. Rendering a
      // run head follows the active run while it is streaming and resolves to
      // the latest persisted node for that run once inactive. This preserves
      // explicit node selection for mid-run history browsing.
      function handleSend(input: string) {
        const model = modelsStore.selectedModel
        if (!model) return

        const baseNodeId = selectedHead.selectedBaseNodeId
        const afterRunId = selectedHead.selectedAfterRunId
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
            if (response.status === 'queued') return

            selectedHead.setSelectedHead({
              type: 'run',
              runId: response.runId,
              baseNodeId: response.baseNodeId,
            })

            if (!wasRunning) {
              // Show the user's message immediately — don't wait for the server
              // round-trip. The optimistic node is replaced on the next refresh.
              messagesStore.addOptimisticUserMessage(
                sessionId,
                input,
                response.baseNodeId,
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

      $effect(() => {
        if (loadedTreePanelWidth || typeof window === 'undefined') return
        loadedTreePanelWidth = true

        const stored = Number(window.localStorage.getItem(treePanelWidthStorageKey))
        if (Number.isFinite(stored) && stored >= minTreePanelWidth) {
          treePanelWidth = clampTreePanelWidth(stored)
        }
      })

      $effect(() => {
        sessionLayout?.style.setProperty(
          '--session-tree-panel-width',
          `${treePanelWidth}px`
        )
      })

      onDestroy(() => {
        treeResizeCleanup?.()
      })

      function toggleTreePanel() {
        treePanelOpen = !treePanelOpen
      }

      function clampTreePanelWidth(width: number) {
        const viewportMax =
          typeof window === 'undefined'
            ? maxTreePanelWidth
            : Math.min(maxTreePanelWidth, Math.floor(window.innerWidth * 0.75))
        return Math.min(Math.max(width, minTreePanelWidth), viewportMax)
      }

      function startTreePanelResize(event: PointerEvent) {
        if (!sessionLayout || !treePanelElement) return

        event.preventDefault()
        treeResizeCleanup?.()

        const handle = event.currentTarget as HTMLElement
        const startX = event.clientX
        const startWidth = treePanelElement.getBoundingClientRect().width
        let currentWidth = startWidth
        let pendingWidth = startWidth
        let frame = 0
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect

        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        handle.setPointerCapture(event.pointerId)

        const applyWidth = () => {
          frame = 0
          currentWidth = pendingWidth
          sessionLayout?.style.setProperty(
            '--session-tree-panel-width',
            `${currentWidth}px`
          )
        }

        const handlePointerMove = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return
          pendingWidth = clampTreePanelWidth(
            startWidth + startX - moveEvent.clientX
          )
          if (frame === 0) frame = requestAnimationFrame(applyWidth)
        }

        const cleanup = () => {
          handle.removeEventListener('pointermove', handlePointerMove)
          handle.removeEventListener('pointerup', handlePointerUp)
          handle.removeEventListener('pointercancel', handlePointerUp)
          if (frame !== 0) cancelAnimationFrame(frame)
          document.body.style.cursor = previousCursor
          document.body.style.userSelect = previousUserSelect
          if (handle.hasPointerCapture(event.pointerId)) {
            handle.releasePointerCapture(event.pointerId)
          }
          treeResizeCleanup = null
        }

        const handlePointerUp = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== event.pointerId) return
          const finalWidth = Math.round(pendingWidth)
          cleanup()
          sessionLayout?.style.setProperty(
            '--session-tree-panel-width',
            `${finalWidth}px`
          )
          treePanelWidth = finalWidth
          try {
            window.localStorage.setItem(treePanelWidthStorageKey, String(finalWidth))
          } catch {
            // Ignore storage failures.
          }
        }

        treeResizeCleanup = cleanup
        handle.addEventListener('pointermove', handlePointerMove)
        handle.addEventListener('pointerup', handlePointerUp)
        handle.addEventListener('pointercancel', handlePointerUp)
      }
</script>

<div
  bind:this={sessionLayout}
  class="relative flex h-full overflow-hidden"
  style={`--session-tree-panel-width: ${treePanelWidth}px; --session-header-height: 48px`}
>
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <!-- Header -->
    <div class="h-[var(--session-header-height)] border-b border-border">
      <div class="flex h-full w-full items-center gap-2 px-3 sm:px-4">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <h1 class="truncate text-base leading-tight font-semibold text-foreground">
            {title ?? 'New Session'}
          </h1>
          {#if projectName}
            <Badge variant="secondary" class="h-6 max-w-56 truncate px-2.5 text-xs">
              {projectName}
            </Badge>
          {/if}
        </div>

        <Button
          variant="ghost"
          size="icon-lg"
          onclick={toggleTreePanel}
          aria-label={treePanelOpen ? 'Close side panel' : 'Open side panel'}
          title={treePanelOpen ? 'Close side panel' : 'Open side panel'}
        >
          <SidebarSimpleIcon />
        </Button>
      </div>
    </div>

    <!-- Messages -->
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <ScrollArea
        bind:viewportRef={messagesContainer}
        class="h-full"
        viewportClass="scroll-mask-y scroll-mask-y-from-98%"
        onViewportScroll={updateLatestState}
      >
        {#if messagesStore.loading}
          <div class="mx-auto flex w-full max-w-6xl items-center justify-center p-8">
            <span class="text-sm text-muted-foreground">Loading messages...</span>
          </div>
        {:else if messagesStore.error}
          <div class="mx-auto flex w-full max-w-6xl items-center justify-center p-8">
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
            class="mx-auto w-full max-w-6xl"
            style:height={`${$virtualizer.getTotalSize()}px`}
            style:position="relative"
          >
            {#each virtualItems as virtualItem (virtualItem.key)}
              {@const row = virtualRows[virtualItem.index]}
              {#if row}
                <div
                  use:measureVirtualRow
                  data-index={virtualItem.index}
                  class="absolute left-0 top-0 w-full px-4 sm:px-6"
                  style:transform={`translateY(${virtualItem.start}px)`}
                >
                  {#if row.type === 'message'}
                    <MessageBubble
                      message={row.block.message}
                      transcriptItems={row.block.items}
                      modelCall={row.block.modelCall}
                      {accordionState}
                      accordionKey={row.key}
                    />
                  {:else if row.type === 'streaming'}
                    <StreamingIndicator
                      parts={messagesStore.streamingParts}
                      {isRunning}
                      {accordionState}
                      accordionKey={row.key}
                    />
                  {:else}
                    <QueuedMessageBubble message={row.message} />
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </ScrollArea>

      {#if !isAtLatest}
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
      {sessionStatus}
      tokenUsageMessages={visibleMessages}
      disabled={isStopping}
    />
  </div>

  {#if treePanelOpen}
    <div
      aria-hidden="true"
      class="h-full shrink-0"
      style:width="var(--session-tree-panel-width)"
    ></div>
    <div
      bind:this={treePanelElement}
      class="absolute inset-y-0 right-0 z-10 min-w-0 overflow-hidden"
      style="width: var(--session-tree-panel-width); contain: layout paint style"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation tree"
        class="group absolute inset-y-0 left-0 z-20 flex w-px cursor-col-resize items-center justify-center bg-border"
        onpointerdown={startTreePanelResize}
      >
        <div class="absolute inset-y-0 -left-1 -right-1"></div>
        <div class="h-8 w-1 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100"></div>
      </div>
      <SessionTreePanel {sessionId} {selectedHead} />
    </div>
  {/if}
</div>
