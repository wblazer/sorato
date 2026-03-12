<script lang="ts">
  import { untrack } from 'svelte'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
  import MessageBubble from './message-bubble.svelte'
  import StreamingIndicator from './streaming-indicator.svelte'
  import Composer from './composer.svelte'

  let { sessionId, title }: { sessionId: string; title: string | null } =
    $props()

  let messagesContainer: HTMLDivElement | undefined = $state()

  // Running state is derived from the session store — the single source
  // of truth. The messages store only tracks streaming *content*.
  const isRunning = $derived(sessionStore.isRunning(sessionId))
  const isStopping = $derived(sessionStore.isStopping(sessionId))

  // Detect if the conversation was recently interrupted — the last
  // message will be the system interruption marker. Used to show
  // a "Resume" button so the user can continue without typing.
  const wasInterrupted = $derived.by(() => {
    const msgs = messagesStore.messages
    if (msgs.length === 0 || isRunning) return false
    const last = msgs[msgs.length - 1]!
    return (
      last.encoded.role === 'system' &&
      typeof last.encoded.content === 'string' &&
      last.encoded.content.includes('interrupted')
    )
  })

  // Load messages when sessionId changes.
  // untrack prevents the effect from subscribing to reactive state
  // read inside loadMessages, which would cause an infinite re-trigger loop.
  $effect(() => {
    if (sessionId) {
      untrack(() => messagesStore.loadMessages(sessionId))
    }
    return () => {
      messagesStore.clear()
    }
  })

  // Auto-scroll to bottom when new messages arrive or streaming parts change
  $effect(() => {
    // Touch reactive dependencies
    messagesStore.messages.length
    messagesStore.streamingParts

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

  // Register Escape hotkey to stop the agent run.
  // The hotkey store's scope system ensures this doesn't fire when
  // an overlay (command palette) is open. The isStopping guard
  // prevents duplicate stop requests from rapid Escape presses.
  $effect(() => {
    const unregister = hotkeyStore.register('Escape', () => {
      if (
        sessionStore.isRunning(sessionId) &&
        !sessionStore.isStopping(sessionId)
      ) {
        handleStop()
      }
    })
    return unregister
  })

  function handleSend(input: string) {
    // Show the user's message immediately — don't wait for the server
    // round-trip. The optimistic node is replaced on the next refresh.
    messagesStore.addOptimisticUserMessage(sessionId, input)
    sessionStore.runAgent(sessionId, input)
  }

  function handleStop() {
    sessionStore.stopAgent(sessionId)
  }

  function handleResume() {
    messagesStore.addOptimisticUserMessage(
      sessionId,
      'Continue where you left off.'
    )
    sessionStore.runAgent(sessionId, 'Continue where you left off.')
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="flex items-center gap-3 border-b border-border px-6 py-3">
    <h1 class="text-sm font-semibold text-foreground">
      {title ?? 'Untitled'}
    </h1>
    <span class="text-xs text-muted-foreground">{sessionId.slice(0, 8)}</span>
    {#if isStopping}
      <span
        class="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5"
      >
        <span
          class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
        ></span>
        <span class="text-[10px] font-medium text-amber-400">stopping</span>
      </span>
    {:else if isRunning}
      <span
        class="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5"
      >
        <span
          class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
        ></span>
        <span class="text-[10px] font-medium text-blue-400">live</span>
      </span>
    {/if}
  </div>

  <!-- Messages -->
  <div bind:this={messagesContainer} class="flex-1 overflow-y-auto">
    {#if messagesStore.loading}
      <div class="flex items-center justify-center p-8">
        <span class="text-sm text-muted-foreground">Loading messages...</span>
      </div>
    {:else if messagesStore.error}
      <div class="flex items-center justify-center p-8">
        <span class="text-sm text-destructive">{messagesStore.error}</span>
      </div>
    {:else if messagesStore.loaded && messagesStore.messages.length === 0 && !isRunning}
      <div class="flex items-center justify-center p-8">
        <span class="text-sm text-muted-foreground">No messages yet</span>
      </div>
    {:else if messagesStore.loaded || isRunning}
      <div class="flex flex-col gap-1 p-4">
        {#each messagesStore.messages as message (message.id)}
          <MessageBubble {message} />
        {/each}

        <StreamingIndicator parts={messagesStore.streamingParts} {isRunning} />
      </div>
    {/if}
  </div>

  <!-- Resume button — shown after interruption -->
  {#if wasInterrupted}
    <div
      class="flex justify-center border-t border-border bg-background px-4 py-2"
    >
      <button
        onclick={handleResume}
        class="flex items-center gap-2 rounded-md border border-input bg-background px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
        Resume
      </button>
    </div>
  {/if}

  <!-- Composer -->
  <Composer
    onSend={handleSend}
    onStop={handleStop}
    {isRunning}
    {isStopping}
    disabled={isRunning}
    placeholder={isStopping
      ? 'Stopping...'
      : isRunning
        ? 'Agent is responding...'
        : 'Send a follow-up message...'}
  />
</div>
