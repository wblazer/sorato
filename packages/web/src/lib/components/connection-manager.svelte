<script lang="ts">
  import {
    Popover,
    PopoverContent,
    PopoverTrigger,
  } from '$lib/components/ui/popover/index.js'
  import Button from '$lib/components/ui/button/button.svelte'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import {
    connectionsStore,
    type Connection,
  } from '$lib/stores/connections.svelte.js'
  import ConnectionDialog from './connection-dialog.svelte'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical'
  import TrashIcon from '@lucide/svelte/icons/trash'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import { onMount } from 'svelte'

  let popoverOpen = $state(false)
  let dialogOpen = $state(false)
  let editingConnection = $state<Connection | null>(null)

  function handleAdd() {
    popoverOpen = false
    dialogOpen = true
    editingConnection = null
  }

  function handleEdit(connection: Connection) {
    editingConnection = connection
    dialogOpen = true
    popoverOpen = false
  }

  function handleSave(data: { url: string; name?: string }) {
    if (!editingConnection) return
    connectionsStore.update(editingConnection.id, data)
    dialogOpen = false
    editingConnection = null
  }

  function handleActivate(id: string) {
    connectionsStore.activate(id)
    popoverOpen = false
  }

  function handleDelete(id: string) {
    connectionsStore.remove(id)
  }

  function displayName(connection: Connection): string {
    return connection.name || connection.url
  }

  function isActive(connection: Connection): boolean {
    return connectionsStore.activeConnection?.id === connection.id
  }

  onMount(() => {
    return actionStore.register({
      id: 'connection.add',
      title: 'Add Connection',
      category: 'Connections',
      description: 'Add an agents server to the connection list.',
      keywords: ['server', 'endpoint', 'url'],
      run: () => {
        editingConnection = null
        dialogOpen = true
      },
    })
  })

  $effect(() => {
    if (!dialogOpen && editingConnection) {
      editingConnection = null
    }
  })
</script>

<div class="flex items-center gap-2 px-2 py-1.5">
  <Popover bind:open={popoverOpen}>
    <PopoverTrigger>
      <button
        class="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <span class="relative flex h-2 w-2">
          {#if connectionsStore.activeConnection}
            <span class="relative inline-flex h-2 w-2 rounded-full bg-green-500"
            ></span>
          {:else}
            <span class="relative inline-flex h-2 w-2 rounded-full bg-gray-400"
            ></span>
          {/if}
        </span>
        <span class="truncate max-w-[160px]">
          {#if connectionsStore.activeConnection}
            {displayName(connectionsStore.activeConnection)}
          {:else}
            No connection
          {/if}
        </span>
      </button>
    </PopoverTrigger>

    <PopoverContent class="w-80 p-0" align="start" sideOffset={4}>
      <div class="flex flex-col">
        <div class="flex items-center justify-between border-b px-3 py-2">
          <span class="text-sm font-medium">Servers</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={() => (popoverOpen = false)}
          >
            <span class="sr-only">Close</span>
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {#if connectionsStore.connections.length === 0}
          <div class="px-3 py-4 text-center text-sm text-muted-foreground">
            No connections configured.
          </div>
        {:else}
          <div class="py-1">
            {#each connectionsStore.connections as connection (connection.id)}
              <div class="flex items-center gap-2 px-3 py-2">
                <button
                  onclick={() => handleActivate(connection.id)}
                  class="flex flex-1 items-center gap-3 rounded-sm py-3 pl-3 hover:bg-accent"
                >
                  {#if isActive(connection)}
                    <span class="h-2 w-2 rounded-full bg-green-500"></span>
                  {:else}
                    <span class="h-2 w-2"></span>
                  {/if}
                  <div class="flex flex-col items-start gap-0.5">
                    <span class="text-sm font-medium leading-none">
                      {displayName(connection)}
                    </span>
                    {#if connection.name}
                      <span class="text-xs text-muted-foreground">
                        {connection.url}
                      </span>
                    {/if}
                  </div>
                </button>

                <Popover>
                  <PopoverTrigger>
                    <Button variant="ghost" size="icon-sm">
                      <MoreVerticalIcon />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-32 p-1" align="end" side="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleEdit(connection)}
                      class="w-full justify-start"
                    >
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleDelete(connection.id)}
                      class="w-full justify-start text-destructive hover:bg-destructive/10"
                    >
                      <TrashIcon />
                      Delete
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>
            {/each}
          </div>
        {/if}

        <div class="border-t px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            class="w-full"
            onclick={handleAdd}
          >
            <PlusIcon class="h-4 w-4 mr-1" />
            Add Server
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</div>

<ConnectionDialog
  bind:open={dialogOpen}
  connection={editingConnection}
  onSave={handleSave}
  onClose={() => {
    dialogOpen = false
    editingConnection = null
  }}
/>
