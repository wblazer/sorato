<script lang="ts">
  import ConnectProviderDialog from './connect-provider-dialog.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Empty from '$lib/components/ui/empty/index.js'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import KeyIcon from 'phosphor-svelte/lib/KeyIcon'

  let open = $state(false)
  const openDialog = () => {
    open = true
  }
</script>

<main class="flex h-screen items-center justify-center overflow-y-auto px-6 py-10">
  <Empty.Root class="max-w-2xl gap-6 border-0 p-8 sm:p-12">
    <Empty.Header class="max-w-lg gap-2">
      <Empty.Media variant="icon" class="mb-3 size-12 [&_svg:not([class*='size-'])]:size-6">
        <KeyIcon class="size-6" />
      </Empty.Media>
      <Empty.Title class="text-lg">Connect a model provider</Empty.Title>
      <Empty.Description class="text-sm">
        Sorato needs provider credentials before it can list models, open project
        workspaces, or start sessions.
      </Empty.Description>
    </Empty.Header>

    <Empty.Content class="gap-3">
      {#if authStore.loading}
        <p class="text-sm text-muted-foreground">Checking provider credentials…</p>
      {:else if authStore.error}
        <p class="text-sm text-danger">{authStore.error}</p>
      {/if}

      <Button size="lg" onclick={openDialog}>
        <KeyIcon class="size-4" />
        Connect Provider
      </Button>
    </Empty.Content>
  </Empty.Root>
</main>

{#if open}
  <ConnectProviderDialog bind:open />
{/if}
