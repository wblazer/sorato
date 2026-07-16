<script lang="ts">
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import GlobalActionHost from '$lib/components/global-action-host.svelte'
  import MarkdownPlayground from '$lib/components/markdown-playground.svelte'
  import { Sidebar } from '$lib/components/sidebar/index.js'
  import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import AppLoading from '$lib/components/app-loading.svelte'
  import NoConnections from '$lib/components/no-connections.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import { appRuntime } from '$lib/stores/app-runtime.svelte.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { onMount } from 'svelte'
  import * as Item from '$lib/components/ui/item/index.js'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'

  let { children } = $props()

  function closeMarkdownPlayground() {
    const url = new URL(page.url)
    url.searchParams.delete('developer')
    void goto(url)
  }

  onMount(() => {
    void clientSettingsStore.loadFromClientConfig()
  })

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
  {#if import.meta.env.DEV && page.url.searchParams.get('developer') === 'markdown'}
    <MarkdownPlayground onClose={closeMarkdownPlayground} />
  {:else if !clientSettingsStore.loaded}
    <AppLoading />
  {:else if connectionsStore.hasConnections}
    <div class="flex h-screen overflow-hidden">
      <Sidebar />
      <main class="relative min-w-0 flex-1 overflow-hidden">
        {#if appRuntime.activationError}
          <div class="flex h-full items-center justify-center px-6 py-10">
            <Item.Root variant="danger" class="max-w-lg">
              <Item.Content>
                <Item.Title>Connection failed</Item.Title>
                <Item.Description>{appRuntime.activationError}</Item.Description
                >
              </Item.Content>
            </Item.Root>
          </div>
        {:else if authStore.loadedForActiveConnection && appRuntime.readyForActiveConnection}
          {@render children()}
        {:else}
          <AppLoading message={appRuntime.activationMessage ?? undefined} />
        {/if}
      </main>
    </div>
  {:else}
    <NoConnections />
  {/if}
</Tooltip.Provider>
