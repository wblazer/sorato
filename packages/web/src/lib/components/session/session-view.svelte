<script lang="ts">
      import { tick } from 'svelte'
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
      import SessionTokenUsage from './session-token-usage.svelte'
      import Composer from './composer.svelte'
      import { Button } from '$lib/components/ui/button/index.js'
      import * as Item from '$lib/components/ui/item/index.js'
      import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
      import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'

      let { sessionId, title }: { sessionId: string; title: string | null } =
        $props()

      let messagesContainer: HTMLElement | null = $state(null)
      let messagesContent: HTMLDivElement | undefined = $state()
      let isAtBottom = $state(true)
      let shouldAutoScroll = $state(true)
      let autoScrollTop: number | undefined
      let resizeObserver: ResizeObserver | undefined

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
      const persistedTranscriptItems = $derived.by(() =>
        projectTranscript(persistedSources(messagesStore.messages), {
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

      const messageBlocks = $derived.by((): ReadonlyArray<MessageRenderBlock> => {
        const blocks: MessageRenderBlock[] = []
        const messages = messagesStore.messages

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

      function handleSend(input: string) {
        const model = modelsStore.selectedModel
        if (!model) return

        scrollToLatestAfterRender()

        if (!sessionStore.isRunning(sessionId)) {
          // Show the user's message immediately — don't wait for the server
          // round-trip. The optimistic node is replaced on the next refresh.
          messagesStore.addOptimisticUserMessage(sessionId, input)
        }

        sessionStore.runAgent(
          sessionId,
          input,
          model,
          modelsStore.selectedOptions
        )
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

      <SessionTokenUsage messages={messagesStore.messages} models={modelsStore.models} />

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
