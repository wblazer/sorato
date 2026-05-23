<script lang="ts">
      import { tick } from 'svelte'
      import { messagesStore } from '$lib/stores/messages.svelte.js'
      import { modelsStore } from '$lib/stores/models.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
      import { persistedSources, projectTranscript } from '$lib/transcript.js'
      import MessageBubble from './message-bubble.svelte'
      import QueuedMessageBubble from './queued-message-bubble.svelte'
      import StreamingIndicator from './streaming-indicator.svelte'
      import Composer from './composer.svelte'
      import { Button } from '$lib/components/ui/button/index.js'

      let { sessionId, title }: { sessionId: string; title: string | null } =
        $props()

      let messagesContainer: HTMLDivElement | undefined = $state()
      let messagesContent: HTMLDivElement | undefined = $state()
      let isAtBottom = $state(true)
      let shouldAutoScroll = $state(true)
      let autoScrollTop: number | undefined
      let canScrollUp = $state(false)
      let canScrollDown = $state(false)
      let resizeObserver: ResizeObserver | undefined

      const bottomThreshold = 8

      // Running state is derived from the session store — the single source
      // of truth. The messages store only tracks streaming *content*.
      const isRunning = $derived(sessionStore.isRunning(sessionId))
      const isStopping = $derived(sessionStore.isStopping(sessionId))
      const queuedMessages = $derived(sessionStore.queuedMessagesFor(sessionId))
      const sessionError = $derived(sessionStore.sessionError(sessionId))
      const persistedTranscriptItems = $derived.by(() =>
        projectTranscript(persistedSources(messagesStore.messages), {
          pretty: clientSettingsStore.prettyToolOutput,
        })
      )

      function updateScrollState() {
        if (!messagesContainer) return

        const distanceFromBottom =
          messagesContainer.scrollHeight -
          messagesContainer.scrollTop -
          messagesContainer.clientHeight

        isAtBottom = distanceFromBottom <= bottomThreshold
        canScrollUp = messagesContainer.scrollTop > bottomThreshold
        canScrollDown = distanceFromBottom > bottomThreshold
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
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="py-4">
    <div class="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
      <div class="min-w-0 flex-1">
        <h1 class="text-sm font-semibold text-foreground">
          {title ?? 'New Session'}
        </h1>
        <span class="text-xs text-muted-foreground">{sessionId.slice(0, 8)}</span>
      </div>

      {#if isStopping}
        <span
          class="flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-muted-foreground"
        >
          <span
            class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
          ></span>
          <span class="text-[10px] font-medium">stopping</span>
        </span>
      {:else if isRunning}
        <span
          class="flex items-center gap-1.5 rounded-full bg-success-muted px-2 py-0.5 text-success-muted-foreground"
        >
          <span
            class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success"
          ></span>
          <span class="text-[10px] font-medium">live</span>
        </span>
      {/if}
    </div>
  </div>

  <!-- Messages -->
  <div class="relative min-h-0 flex-1 overflow-hidden">
    <div
      bind:this={messagesContainer}
      class="h-full overflow-y-auto"
      onscroll={handleScroll}
      onwheel={handleWheel}
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
          <span class="text-sm text-danger">{messagesStore.error}</span>
        </div>
      {:else if messagesStore.loaded || isRunning}
        <div
          bind:this={messagesContent}
          class="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-5 sm:px-6"
        >
          {#each messagesStore.messages as message (message.id)}
            <MessageBubble
              {message}
              transcriptItems={persistedTranscriptItems.filter(
                (item) => {
                  const source = item.type === 'message' ? item.source : item.callSource
                  return source.type === 'persisted' && source.message === message
                }
              )}
            />
          {/each}

          <StreamingIndicator parts={messagesStore.streamingParts} {isRunning} />

          {#each queuedMessages as message (message.id)}
            <QueuedMessageBubble {message} />
          {/each}
        </div>
      {/if}
    </div>

    {#if canScrollUp}
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background/35 to-transparent backdrop-blur-[0.5px]"
      ></div>
    {/if}

    {#if canScrollDown}
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background/35 to-transparent backdrop-blur-[0.5px]"
      ></div>
    {/if}

    {#if !isAtBottom && (isRunning || messagesStore.streamingParts.length > 0)}
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
    focusKey={sessionId}
    {sessionError}
    disabled={isStopping}
  />
</div>
