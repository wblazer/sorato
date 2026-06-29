<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import {
    Popover,
    PopoverContent,
    PopoverTrigger,
  } from '$lib/components/ui/popover/index.js'
  import {
    canStartIntegratedServer,
    restartAndConnectIntegratedServer,
    startAndConnectIntegratedServer,
    stopAndRemoveIntegratedServer,
    type IntegratedServerError,
  } from '$lib/desktop-server.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import {
    connectionsStore,
    type Connection,
  } from '$lib/stores/connections.svelte.js'
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon'
  import DesktopTowerIcon from 'phosphor-svelte/lib/DesktopTowerIcon'
  import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon'
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import TrashIcon from 'phosphor-svelte/lib/TrashIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'
  import { Effect } from 'effect'
  import { onMount } from 'svelte'
  import ConnectionDialog from './connection-dialog.svelte'

  let popoverOpen = $state(false)
  let dialogOpen = $state(false)
  let editingConnection = $state<Connection | null>(null)
  let startingIntegratedServer = $state(false)
  let restartingIntegratedServer = $state(false)
  let stoppingIntegratedServer = $state(false)
  let integratedServerError = $state('')
  type IntegratedServerAction =
    | ReturnType<typeof startAndConnectIntegratedServer>
    | ReturnType<typeof stopAndRemoveIntegratedServer>
    | ReturnType<typeof restartAndConnectIntegratedServer>

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
    if (editingConnection) {
      Effect.runSync(connectionsStore.update(editingConnection.id, data))
    } else {
      const connection = Effect.runSync(
        connectionsStore.add({ ...data, source: 'remote' }),
      )
      Effect.runSync(connectionsStore.activate(connection.id))
    }
    dialogOpen = false
    editingConnection = null
  }

  function runIntegratedServerAction(
    action: IntegratedServerAction,
    setPending: (value: boolean) => void,
  ) {
    integratedServerError = ''
    setPending(true)
    const clearPending = Effect.sync(() => setPending(false))
    void Effect.runPromise(
      action.pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            integratedServerError = error.message
          }),
        ),
        Effect.ensuring(clearPending),
      ),
    )
  }

  function handleStartIntegratedServer() {
    runIntegratedServerAction(startAndConnectIntegratedServer(), (value) => {
      startingIntegratedServer = value
    })
  }

  function handleStopIntegratedServer() {
    runIntegratedServerAction(stopAndRemoveIntegratedServer(), (value) => {
      stoppingIntegratedServer = value
    })
  }

  function handleRestartIntegratedServer() {
    runIntegratedServerAction(restartAndConnectIntegratedServer(), (value) => {
      restartingIntegratedServer = value
    })
  }

  function handleActivate(id: string) {
    Effect.runSync(connectionsStore.activate(id))
  }

  function handleDelete(id: string) {
    Effect.runSync(connectionsStore.remove(id))
  }

  function displayName(connection: Connection): string {
    const localServerName = 'Local Server'
    if (
      connection.source === 'integrated' &&
      connection.name === 'Desktop Server'
    ) {
      return localServerName
    }
    return connection.name || connection.url
  }

  function isActive(connection: Connection): boolean {
    return connectionsStore.activeConnection?.id === connection.id
  }

  function canManage(connection: Connection): boolean {
    return connection.source !== 'integrated'
  }

  function isIntegrated(connection: Connection): boolean {
    return connection.source === 'integrated'
  }

  function hasIntegratedConnection(): boolean {
    return connectionsStore.connections.some(
      (connection) => connection.source === 'integrated',
    )
  }

  onMount(() => {
    return actionStore.register({
      id: 'connection.add',
      title: 'Add Connection',
      category: 'Connections',
      description: 'Add a Sorato server to the connection list.',
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

<div class="w-full min-w-0">
  <Popover bind:open={popoverOpen}>
    <PopoverTrigger class="block w-full min-w-0">
      <button
        type="button"
        title={connectionsStore.activeConnection
          ? displayName(connectionsStore.activeConnection)
          : 'No connection'}
        class="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2.5 text-sm/relaxed font-medium text-muted-foreground hover:bg-base-hover hover:text-foreground"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          {#if connectionsStore.activeConnection}
            <span class="relative inline-flex h-2 w-2 rounded-full bg-success"
            ></span>
          {:else}
            <span
              class="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground"
            ></span>
          {/if}
        </span>
        <span class="min-w-0 flex-1 truncate text-left">
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
          <div class="grid gap-1 p-2">
            {#each connectionsStore.connections as connection (connection.id)}
              <div class="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  title={displayName(connection)}
                  onclick={() => handleActivate(connection.id)}
                  aria-current={isActive(connection) ? 'true' : undefined}
                  class="flex h-7 min-w-0 flex-1 overflow-hidden items-center gap-2 rounded-md px-2 text-left hover:bg-base-hover"
                >
                  {#if isActive(connection)}
                    <span class="h-2 w-2 shrink-0 rounded-full bg-success"
                    ></span>
                  {:else}
                    <span
                      class="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/50"
                    ></span>
                  {/if}
                  <span
                    class="block min-w-0 flex-1 truncate text-sm font-medium"
                  >
                    {displayName(connection)}
                  </span>
                </button>

                <Popover>
                  <PopoverTrigger>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="text-muted-foreground hover:bg-base-hover hover:text-foreground"
                      aria-label={`Manage ${displayName(connection)}`}
                    >
                      <DotsThreeIcon />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    class="w-36 gap-0.5 p-1"
                    align="end"
                    side="right"
                  >
                    {#if isIntegrated(connection)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={handleRestartIntegratedServer}
                        disabled={restartingIntegratedServer ||
                          stoppingIntegratedServer}
                        class="w-full justify-start"
                      >
                        <ArrowsClockwiseIcon />
                        {restartingIntegratedServer
                          ? 'Restarting…'
                          : 'Restart Server'}
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="sm"
                        onclick={handleStopIntegratedServer}
                        disabled={stoppingIntegratedServer ||
                          restartingIntegratedServer}
                        class="w-full justify-start"
                      >
                        <TrashIcon />
                        {stoppingIntegratedServer ? 'Stopping…' : 'Stop Server'}
                      </Button>
                    {:else}
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
                    {/if}
                  </PopoverContent>
                </Popover>
              </div>
            {/each}
          </div>
        {/if}

        <div class="grid gap-2 border-t p-2">
          {#if canStartIntegratedServer() && !hasIntegratedConnection()}
            <Button
              variant="outline"
              size="sm"
              onclick={handleStartIntegratedServer}
              disabled={startingIntegratedServer}
              class="w-full justify-center"
            >
              <DesktopTowerIcon />
              {startingIntegratedServer
                ? 'Starting server…'
                : 'Spawn Local Server'}
            </Button>
          {/if}
          {#if integratedServerError}
            <p class="text-xs text-danger-muted-foreground">
              {integratedServerError}
            </p>
          {/if}
          <Button
            variant="outline"
            size="sm"
            onclick={handleAdd}
            class="w-full justify-center"
          >
            <PlusIcon />
            Connect With URL
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
