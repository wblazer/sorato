<script lang="ts">
  import '../app.css'
      import favicon from '$lib/assets/favicon.svg'
      import GlobalActionHost from '$lib/components/global-action-host.svelte'
      import { Sidebar } from '$lib/components/sidebar/index.js'
      import { sseStore } from '$lib/stores/sse.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
      import { connectionsStore } from '$lib/stores/connections.svelte.js'
      import NoConnections from '$lib/components/no-connections.svelte'

      let { children } = $props()

      $effect(() => {
        // Only connect to SSE if we have an active connection
        if (connectionsStore.activeConnection) {
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
  <title>Agents</title>
</svelte:head>

<GlobalActionHost />

{#if connectionsStore.hasConnections}
  <div class="flex h-screen overflow-hidden">
    <Sidebar />
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
{:else}
  <NoConnections />
{/if}
