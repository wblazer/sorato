<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
      import { untrack } from 'svelte'
      import { messagesStore } from '$lib/stores/messages.svelte.js'
      import { modelsStore } from '$lib/stores/models.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
      import PlayIcon from 'phosphor-svelte/lib/PlayIcon'
      import MessageBubble from './message-bubble.svelte'
      import QueuedMessageBubble from './queued-message-bubble.svelte'
      import StreamingIndicator from './streaming-indicator.svelte'
      import Composer from './composer.svelte'

      let { sessionId, title }: { sessionId: string; title: string | null } =
        $props()

      let messagesContainer: HTMLDivElement | undefined = $state()
      let updatingModel = $state(false)

      const session = $derived(
        sessionStore.sessions.find((item) => item.id === sessionId) ?? null
      )

      // Running state is derived from the session store — the single source
      // of truth. The messages store only tracks streaming *content*.
      const isRunning = $derived(sessionStore.isRunning(sessionId))
      const isStopping = $derived(sessionStore.isStopping(sessionId))
      const queuedMessages = $derived(sessionStore.queuedMessagesFor(sessionId))

      // Detect if the conversation was recently interrupted — the last
      // message will be the system interruption marker. Used to show
      // a "Resume" button so the user can continue without typing.
      const wasInterrupted = $derived.by(() => {
        const msgs = messagesStore.messages
        if (msgs.length === 0 || isRunning) return false
        const last = msgs.at(-1)
        if (!last) return false
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

      $effect(() => {
        if (!session?.directory) {
          modelsStore.clear()
          return
        }

        modelsStore.load(session.directory)
      })

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
        if (!sessionStore.isRunning(sessionId)) {
          // Show the user's message immediately — don't wait for the server
          // round-trip. The optimistic node is replaced on the next refresh.
          messagesStore.addOptimisticUserMessage(sessionId, input)
        }

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

      async function handleModel(value: string) {
        updatingModel = true
        try {
          const ok = await sessionStore.setModel(sessionId, value)
          if (ok) modelsStore.remember(value)
        } finally {
          updatingModel = false
        }
      }

      function handleAttach() {}
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

  <!-- Resume button — shown after interruption -->
  {#if wasInterrupted}
    <div class="px-4 py-2">
      <div class="mx-auto flex w-full max-w-6xl justify-center">
        <Button
          onclick={handleResume}
          variant="outline"
          size="lg"
          class="gap-2 px-4 py-1.5 text-sm"
        >
          <PlayIcon />
          Resume
        </Button>
      </div>
    </div>
  {/if}

  <!-- Composer -->
  <Composer
    onSend={handleSend}
    onStop={handleStop}
    onAttach={handleAttach}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={session?.model ?? null}
    modelLoading={modelsStore.loading}
    modelDisabled={updatingModel}
    {isRunning}
    {isStopping}
    disabled={isStopping}
  />
</div>
