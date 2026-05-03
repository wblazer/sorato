<script lang="ts">
      import { messagesStore } from '$lib/stores/messages.svelte.js'
      import { modelsStore } from '$lib/stores/models.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import MessageBubble from './message-bubble.svelte'
      import QueuedMessageBubble from './queued-message-bubble.svelte'
      import StreamingIndicator from './streaming-indicator.svelte'
      import Composer from './composer.svelte'
      import * as Item from '$lib/components/ui/item/index.js'
      import { Button } from '$lib/components/ui/button/index.js'
      import XIcon from 'phosphor-svelte/lib/XIcon'

      let { sessionId, title }: { sessionId: string; title: string | null } =
        $props()

      let messagesContainer: HTMLDivElement | undefined = $state()

      // Running state is derived from the session store — the single source
      // of truth. The messages store only tracks streaming *content*.
      const isRunning = $derived(sessionStore.isRunning(sessionId))
      const isStopping = $derived(sessionStore.isStopping(sessionId))
      const queuedMessages = $derived(sessionStore.queuedMessagesFor(sessionId))
      const sessionError = $derived(sessionStore.sessionError(sessionId))

      // Auto-scroll to bottom when new messages arrive or streaming parts change
      $effect(() => {
        // Touch reactive dependencies
        messagesStore.messages.length
        messagesStore.streamingParts
        queuedMessages.length

        if (messagesContainer) {
          const { scrollTop, scrollHeight, clientHeight } = messagesContainer
          const isNearBottom = scrollHeight - scrollTop - clientHeight < 120
          if (isNearBottom) {
            requestAnimationFrame(() => {
              messagesContainer?.scrollTo({
                top: messagesContainer.scrollHeight,
                behavior: 'smooth',
              })
            })
          }
        }
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

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="py-4">
    <div class="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
      <div class="min-w-0 flex-1">
        <h1 class="text-sm font-semibold text-foreground">
          {title ?? 'Untitled'}
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
  <div bind:this={messagesContainer} class="flex-1 overflow-y-auto">
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
    {:else if messagesStore.loaded && messagesStore.messages.length === 0 && !isRunning}
      <div
        class="mx-auto flex w-full max-w-6xl items-center justify-center p-8"
      >
        <span class="text-sm text-muted-foreground">No messages yet</span>
      </div>
    {:else if messagesStore.loaded || isRunning}
      <div
        class="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-5 sm:px-6"
      >
        {#each messagesStore.messages as message (message.id)}
          <MessageBubble {message} />
        {/each}

        <StreamingIndicator parts={messagesStore.streamingParts} {isRunning} />

        {#each queuedMessages as message (message.id)}
          <QueuedMessageBubble {message} />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Composer -->
  {#if sessionError}
    <div class="relative z-20 bg-background">
      <div class="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Item.Root variant="danger" class="-mb-3 shadow-sm shadow-shadow/30">
          <Item.Content>
            <Item.Title>Run failed</Item.Title>
            <Item.Description>
              {sessionError}
            </Item.Description>
          </Item.Content>
          <Item.Actions class="ml-auto self-start">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              onclick={handleDismissError}
              title="Dismiss error"
              aria-label="Dismiss error"
            >
              <XIcon />
            </Button>
          </Item.Actions>
        </Item.Root>
      </div>
    </div>
  {/if}

  <Composer
    onSend={handleSend}
    onStop={handleStop}
    onAttach={handleAttach}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={modelsStore.selectedModel}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    {isRunning}
    {isStopping}
    disabled={isStopping}
  />
</div>
