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
      import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon'
      import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
      import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
      import TrashIcon from 'phosphor-svelte/lib/TrashIcon'
      import XIcon from 'phosphor-svelte/lib/XIcon'
      import ConnectionDialog from './connection-dialog.svelte'
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
        type="button"
        class="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
      >
        <span class="relative flex h-2 w-2">
          {#if connectionsStore.activeConnection}
            <span class="relative inline-flex h-2 w-2 rounded-full bg-accent"
            ></span>
          {:else}
              <span class="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground"
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
            size="icon"
            onclick={() => (popoverOpen = false)}
          >
            <span class="sr-only">Close</span>
            <XIcon />
          </Button>
        </div>

        {#if connectionsStore.connections.length === 0}
          <div class="px-3 py-4 text-center text-sm text-muted-foreground">
            No connections configured.
          </div>
        {:else}
          <div class="py-1">
            {#each connectionsStore.connections as connection (connection.id)}
              <div class="flex items-center gap-1 px-3 py-1.5">
                <button
                  type="button"
                  onclick={() => handleActivate(connection.id)}
                   class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-hover"
                >
                  {#if isActive(connection)}
                    <span class="h-2 w-2 rounded-full bg-accent"></span>
                  {:else}
                    <span class="h-2 w-2"></span>
                  {/if}
                  <span class="truncate text-sm font-medium leading-none">
                    {displayName(connection)}
                  </span>
                </button>

                <Popover>
                  <PopoverTrigger>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                       class="text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      <DotsThreeIcon />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    class="w-32 gap-0.5 p-1"
                    align="end"
                    side="right"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleEdit(connection)}
                      class="w-full justify-start"
                    >
                      <PencilSimpleIcon />
                      Edit
                    </Button>
                    <Button
                      variant="ghost-destructive"
                      size="sm"
                      onclick={() => handleDelete(connection.id)}
                      class="w-full justify-start"
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
