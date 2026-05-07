<script lang="ts">
  import '../app.css'
      import favicon from '$lib/assets/favicon.svg'
      import GlobalActionHost from '$lib/components/global-action-host.svelte'
      import { Sidebar } from '$lib/components/sidebar/index.js'
      import { sseStore } from '$lib/stores/sse.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
      import { connectionsStore } from '$lib/stores/connections.svelte.js'
      import { authStore } from '$lib/stores/auth.svelte.js'
      import AppLoading from '$lib/components/app-loading.svelte'
      import NoConnections from '$lib/components/no-connections.svelte'
      import ProviderRequired from '$lib/components/provider-required.svelte'
      import * as Tooltip from '$lib/components/ui/tooltip/index.js'

      let { children } = $props()

      $effect(() => {
        // Only connect to SSE if we have an active connection
        if (connectionsStore.activeConnection) {
          void authStore.load()

          // Global SSE — one connection for the app's lifetime.
          // Must connect before fetchSessions so that RunStart/RunEnd events
          // from any in-flight runs are captured from the start.
          sseStore.connect()
          sessionStore.fetchSessions()

          return () => {
            sseStore.disconnect()
          }
        }
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
    {#if !authStore.loadedForActiveConnection}
      <AppLoading />
    {:else if authStore.hasAuthenticatedProvider}
      <div class="flex h-screen overflow-hidden">
        <Sidebar />
        <main class="flex-1 overflow-y-auto">
          {@render children()}
        </main>
      </div>
    {:else}
      <ProviderRequired />
    {/if}
  {:else}
    <NoConnections />
  {/if}
</Tooltip.Provider>
