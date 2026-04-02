<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import HardDrivesIcon from 'phosphor-svelte/lib/HardDrivesIcon'
  import ConnectionDialog from './connection-dialog.svelte'
  import { onMount } from 'svelte'

  let dialogOpen = $state(false)

  function handleSave(data: { url: string; name?: string }) {
    const newConnection = connectionsStore.add(data)
    connectionsStore.activate(newConnection.id)
    dialogOpen = false
  }

  onMount(() => {
    return actionStore.register({
      id: 'connection.add',
      title: 'Add Connection',
      category: 'Connections',
      description: 'Add an agents server to the connection list.',
      keywords: ['server', 'endpoint', 'url'],
      run: () => {
        dialogOpen = true
      },
    })
  })
</script>

<div class="flex h-full flex-col items-center justify-center p-8">
  <div class="flex h-16 w-16 items-center justify-center rounded-full bg-background">
    <HardDrivesIcon class="h-8 w-8 text-muted" />
  </div>

  <h2 class="mt-4 text-lg font-semibold">No Server Connection</h2>
  <p class="mt-2 max-w-sm text-center text-sm text-muted">
    You need to connect to an agents server to get started. Add a connection to
    your local server or a remote instance.
  </p>

  <Button class="mt-6" onclick={() => (dialogOpen = true)}>
    Add Connection
  </Button>

  <p class="mt-4 text-xs text-muted">
    Example: <code class="rounded bg-background px-1 py-0.5"
      >http://localhost:3100</code
    >
  </p>
</div>

<ConnectionDialog
  bind:open={dialogOpen}
  connection={null}
  onSave={handleSave}
  onClose={() => (dialogOpen = false)}
/>
