<script lang="ts">
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import GlobalActionHost from '$lib/components/global-action-host.svelte'
  import { Sidebar } from '$lib/components/sidebar/index.js'
  import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import AppLoading from '$lib/components/app-loading.svelte'
  import NoConnections from '$lib/components/no-connections.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import { appRuntime } from '$lib/stores/app-runtime.svelte.js'

  let { children } = $props()

  $effect(() => {
    const activeConnection = connectionsStore.activeConnection

    if (activeConnection) {
      void appRuntime.activateConnection(activeConnection)
      return
    }

    appRuntime.deactivateConnection()
  })

  // Keep hotkey enabled states in sync with overlay scopes.
  $effect(() => {
    hotkeyStore.syncScopes()
  })
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Sorato</title>
</svelte:head>

<GlobalActionHost />

<Tooltip.Provider>
  {#if connectionsStore.hasConnections}
    <div class="flex h-screen overflow-hidden">
      <Sidebar />
      <main class="relative min-w-0 flex-1 overflow-hidden">
        {#if authStore.loadedForActiveConnection}
          {@render children()}
        {:else}
          <AppLoading />
        {/if}
      </main>
    </div>
  {:else}
    <NoConnections />
  {/if}
</Tooltip.Provider>
