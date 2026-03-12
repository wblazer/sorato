<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import ConnectionDialog from './connection-dialog.svelte'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import ServerIcon from '@lucide/svelte/icons/server'

  let dialogOpen = $state(false)

  function handleSave(data: { url: string; name?: string }) {
    const newConnection = connectionsStore.add(data)
    connectionsStore.activate(newConnection.id)
    dialogOpen = false
  }
</script>

<div class="flex h-full flex-col items-center justify-center p-8">
  <div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
    <ServerIcon class="h-8 w-8 text-muted-foreground" />
  </div>

  <h2 class="mt-4 text-lg font-semibold">No Server Connection</h2>
  <p class="mt-2 max-w-sm text-center text-sm text-muted-foreground">
    You need to connect to an agents server to get started. Add a connection to
    your local server or a remote instance.
  </p>

  <Button class="mt-6" onclick={() => (dialogOpen = true)}>
    Add Connection
  </Button>

  <p class="mt-4 text-xs text-muted-foreground">
    Example: <code class="rounded bg-muted px-1 py-0.5"
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
