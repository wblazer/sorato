<script lang="ts">
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import Composer from './composer.svelte'

  let sending = $state(false)
  let model = $state<string>('')

  $effect(() => {
    const dir = sessionStore.selectedDirectory
    if (!dir) {
      modelsStore.clear()
      model = ''
      return
    }

    modelsStore.load(dir)
  })

  $effect(() => {
    const ids = new Set(modelsStore.models.map((item) => item.id))
    if (model && ids.has(model)) return
    model = modelsStore.pick() ?? ''
  })

  function handleModel(value: string) {
    model = value
    modelsStore.remember(value)
  }

  function handleAttach() {}

  async function handleSend(input: string) {
    if (sending || !model) return
    sending = true

    try {
      // Create the session in the current directory
      const session = await sessionStore.createSession(undefined, model)
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
  <div class="py-4">
    <div class="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div class="min-w-0 flex-1">
        <h1 class="text-sm font-semibold text-foreground">New Session</h1>
        {#if sessionStore.selectedDirectory}
          <span class="text-xs text-muted-foreground">
            {sessionStore.selectedDirectory}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Empty state / prompt -->
  <div
    class="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center"
  >
    <div>
      <p class="text-sm text-muted-foreground">
        Start a conversation with the agent.
      </p>
      {#if !sessionStore.selectedDirectory}
        <p class="mt-2 text-xs text-destructive">Select a directory first.</p>
      {:else if modelsStore.error}
        <p class="mt-2 text-xs text-destructive">{modelsStore.error}</p>
      {:else if !modelsStore.loading && modelsStore.models.length === 0}
        <p class="mt-2 text-xs text-destructive">
          No models available on this server.
        </p>
      {/if}
    </div>
  </div>

  <!-- Composer -->
  <Composer
    onSend={handleSend}
    onAttach={handleAttach}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={model || null}
    modelLoading={modelsStore.loading}
    modelDisabled={!sessionStore.selectedDirectory || sending}
    disabled={sending ||
      !sessionStore.selectedDirectory ||
      modelsStore.loading ||
      !model}
    placeholder={sending ? 'Creating session...' : 'What would you like to do?'}
  />
</div>
