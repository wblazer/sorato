<script lang="ts">
  import GlobalCommandPalette from './global-command-palette.svelte'
      import { actionStore } from '$lib/stores/actions.svelte.js'
      import { onMount } from 'svelte'

      let open = $state(false)

      onMount(() => {
        const unregister = [
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
