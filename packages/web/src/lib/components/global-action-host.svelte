<script lang="ts">
  import GlobalCommandPalette from './global-command-palette.svelte'
      import ConnectProviderDialog from './connect-provider-dialog.svelte'
      import { actionStore } from '$lib/stores/actions.svelte.js'
      import { connectionsStore } from '$lib/stores/connections.svelte.js'
      import { onMount } from 'svelte'

      let open = $state(false)
      let connectOpen = $state(false)

      onMount(() => {
        const unregister = [
          actionStore.register({
            id: 'provider.connect',
            title: 'Connect Provider',
            category: 'Providers',
            description: 'Store an API key for a model provider on this server.',
            keywords: ['auth', 'api key', 'model', 'provider'],
            enabled: () => !!connectionsStore.activeConnection,
            run: () => {
              connectOpen = true
            },
          }),
          actionStore.register({
            id: 'app.command-palette',
            title: 'Open Command Palette',
            category: 'Application',
            description: 'Search and run actions from anywhere in the app.',
            keywords: ['commands', 'actions', 'launcher'],
            defaultShortcut: 'Control+P',
            palette: 'never',
            run: () => {
              open = true
            },
          }),
        ]

        return () => {
          unregister.forEach((cleanup) => {
            cleanup()
          })
        }
      })
</script>

{#if open}
  <GlobalCommandPalette bind:open />
{/if}

{#if connectOpen}
  <ConnectProviderDialog bind:open={connectOpen} />
{/if}
