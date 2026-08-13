<script lang="ts">
  import { SessionView, NewSession } from '$lib/components/session/index.js'
  import ProjectRequired from '$lib/components/project-required.svelte'
  import ProviderRequired from '$lib/components/provider-required.svelte'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { serverInfoStore } from '$lib/stores/server-info.svelte.js'

  const selectedSession = $derived(sessionStore.selectedSession)
</script>

{#if !authStore.hasAuthenticatedProvider && !serverInfoStore.developerMode}
  <ProviderRequired />
{:else if projectStore.projects.length === 0}
  <ProjectRequired />
{:else if selectedSession}
  <SessionView sessionId={selectedSession.id} title={selectedSession.title} />
{:else}
  <NewSession />
{/if}
