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
  <NewSession />
{/if}
