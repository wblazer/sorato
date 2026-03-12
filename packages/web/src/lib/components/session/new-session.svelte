<script lang="ts">
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import Composer from './composer.svelte'

  let sending = $state(false)

  async function handleSend(input: string) {
    if (sending) return
    sending = true

    try {
      // Create the session in the current directory
      const session = await sessionStore.createSession()
      if (!session) return

      // Prepare the messages store for this session BEFORE Svelte
      // transitions to SessionView. This sets currentSessionId and
      // marks the store as loaded, so when SessionView mounts and
      // calls loadMessages, it sees the session is already set up
      // and does a background refresh — preserving the optimistic
      // message instead of hiding it behind "Loading messages...".
      messagesStore.prepareSession(session.id)
      messagesStore.addOptimisticUserMessage(session.id, input)

      // Fire-and-forget — events stream via global SSE
      await sessionStore.runAgent(session.id, input)

      // selectSession is already called by createSession,
      // so the page will transition to SessionView
    } finally {
      sending = false
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="flex items-center gap-3 border-b border-border px-6 py-3">
    <h1 class="text-sm font-semibold text-foreground">New Session</h1>
    {#if sessionStore.selectedDirectory}
      <span class="text-xs text-muted-foreground">
        {sessionStore.selectedDirectory}
      </span>
    {/if}
  </div>

  <!-- Empty state / prompt -->
  <div class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
    <div class="text-center">
      <p class="text-sm text-muted-foreground">
        Start a conversation with the agent.
      </p>
      {#if !sessionStore.selectedDirectory}
        <p class="mt-2 text-xs text-destructive">Select a directory first.</p>
      {/if}
    </div>
  </div>

  <!-- Composer -->
  <Composer
    onSend={handleSend}
    disabled={sending || !sessionStore.selectedDirectory}
    placeholder={sending ? 'Creating session...' : 'What would you like to do?'}
  />
</div>
