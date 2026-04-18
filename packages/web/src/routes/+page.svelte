<script lang="ts">
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
    import { SessionView, NewSession } from '$lib/components/session/index.js'

    const selectedSession = $derived(
      sessionStore.sessions.find((s) => s.id === sessionStore.selectedSessionId)
    )
</script>

{#if sessionStore.composing}
  <NewSession />
{:else if selectedSession}
  <SessionView sessionId={selectedSession.id} title={selectedSession.title} />
{:else}
  <div class="flex flex-1 items-center justify-center p-8">
    <p class="text-sm text-muted">Select a session to get started</p>
  </div>
{/if}
