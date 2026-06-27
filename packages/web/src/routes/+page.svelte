<script lang="ts">
  import { SessionView, NewSession } from '$lib/components/session/index.js'
  import ProjectRequired from '$lib/components/project-required.svelte'
  import ProviderRequired from '$lib/components/provider-required.svelte'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'

  const activeTab = $derived(tabStore.activeTab)
  const selectedSession = $derived(
    sessionStore.sessions.find((s) => s.id === activeTab?.sessionId),
  )

  function sessionFor(tab: NonNullable<typeof activeTab>) {
    return sessionStore.sessions.find((session) => session.id === tab.sessionId)
  }
</script>

{#if !activeTab}
  <div class="h-full"></div>
{:else if !authStore.hasAuthenticatedProvider}
  <ProviderRequired />
{:else if projectStore.projects.length === 0}
  <ProjectRequired />
{:else}
  {#each tabStore.tabs as tab (tab.id)}
    {@const session = sessionFor(tab)}
    {#if session}
      <div class="h-full" hidden={tab.id !== tabStore.activeTabId}>
        <SessionView
          sessionId={session.id}
          title={session.title}
          active={tab.id === tabStore.activeTabId}
        />
      </div>
    {/if}
  {/each}

  {#if !selectedSession}
    <NewSession />
  {/if}
{/if}
