<script lang="ts">
  import {
    canStartIntegratedServer,
    startAndConnectIntegratedServer,
    type IntegratedServerError,
  } from '$lib/desktop-server.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import CloudIcon from 'phosphor-svelte/lib/CloudIcon'
  import DesktopTowerIcon from 'phosphor-svelte/lib/DesktopTowerIcon'
  import HardDrivesIcon from 'phosphor-svelte/lib/HardDrivesIcon'
  import { Effect } from 'effect'
  import { onMount } from 'svelte'
  import ConnectionDialog from './connection-dialog.svelte'

  let dialogOpen = $state(false)
  let startingIntegratedServer = $state(false)
  let integratedServerError = $state('')

  function handleSave(data: { url: string; name?: string }) {
    const newConnection = Effect.runSync(
      connectionsStore.add({ ...data, source: 'remote' }),
    )
    Effect.runSync(connectionsStore.activate(newConnection.id))
    dialogOpen = false
  }

  function handleStartIntegratedServer() {
    integratedServerError = ''
    startingIntegratedServer = true
    const clearPending = Effect.sync(() => {
      startingIntegratedServer = false
    })
    void Effect.runPromise(
      startAndConnectIntegratedServer().pipe(
        Effect.catch((error: IntegratedServerError) =>
          Effect.sync(() => {
            integratedServerError = error.message
          }),
        ),
        Effect.ensuring(clearPending),
      ),
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
        dialogOpen = true
      },
    })
  })
</script>

<div class="grid min-h-screen place-items-center p-6">
  <div class="flex w-full max-w-3xl flex-col items-center text-center">
    <div
      class="flex h-16 w-16 items-center justify-center rounded-full bg-surface"
    >
      <HardDrivesIcon class="h-8 w-8 text-muted-foreground" />
    </div>

    <h2 class="mt-4 text-lg font-semibold">No Server Connection</h2>

    <div class="mt-6 inline-flex flex-col gap-2">
      {#if canStartIntegratedServer()}
        <button
          type="button"
          onclick={handleStartIntegratedServer}
          disabled={startingIntegratedServer}
          class="flex min-w-64 items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left transition hover:border-primary-muted hover:bg-base-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <DesktopTowerIcon class="h-5 w-5 shrink-0 text-primary" />
          <div class="min-w-0">
            <div class="text-sm font-medium">
              {startingIntegratedServer
                ? 'Starting server…'
                : 'Spawn Local Server'}
            </div>
            <div class="text-xs text-muted-foreground">
              Start a local Sorato server.
            </div>
          </div>
        </button>
      {/if}

      <button
        type="button"
        onclick={() => (dialogOpen = true)}
        class="flex min-w-64 items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left transition hover:border-primary-muted hover:bg-base-hover"
      >
        <CloudIcon class="h-5 w-5 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <div class="text-sm font-medium">Connect With URL</div>
          <div class="text-xs text-muted-foreground">
            Use an existing local or cloud server.
          </div>
        </div>
      </button>
    </div>

    {#if integratedServerError}
      <p class="mt-4 max-w-lg text-sm text-danger-muted-foreground">
        {integratedServerError}
      </p>
    {/if}
  </div>
</div>

<ConnectionDialog
  bind:open={dialogOpen}
  connection={null}
  onSave={handleSave}
  onClose={() => (dialogOpen = false)}
/>
