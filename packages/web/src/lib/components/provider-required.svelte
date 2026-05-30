<script lang="ts">
  import ConnectProviderDialog from './connect-provider-dialog.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Empty from '$lib/components/ui/empty/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import KeyIcon from 'phosphor-svelte/lib/KeyIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'

  let open = $state(false)
  const openDialog = () => {
    open = true
  }

  const retry = () => {
    void authStore.load()
  }
</script>

<main class="flex h-screen items-center justify-center overflow-y-auto px-6 py-10">
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon">
        <KeyIcon />
      </Empty.Media>
      {#if authStore.error}
        <Empty.Title>Couldn’t check provider credentials</Empty.Title>
        <Empty.Description>
          Sorato couldn’t reach the server endpoint that reports configured model
          providers. Retry the check before connecting a provider.
        </Empty.Description>
      {:else}
        <Empty.Title>Connect a model provider</Empty.Title>
        <Empty.Description>
          Sorato needs provider credentials before it can list models, open project
          workspaces, or start sessions.
        </Empty.Description>
      {/if}
    </Empty.Header>

    <Empty.Content>
      {#if authStore.loading}
        <p class="text-sm text-muted-foreground">Checking provider credentials…</p>
      {:else if authStore.error}
        <Item.Root variant="danger" class="max-w-lg text-left">
          <Item.Media variant="icon">
            <WarningCircleIcon />
          </Item.Media>
          <Item.Content>
            <Item.Title>Provider check failed</Item.Title>
            <Item.Description>{authStore.error}</Item.Description>
          </Item.Content>
          <Item.Actions>
            <Button variant="outline" onclick={retry}>Retry</Button>
          </Item.Actions>
        </Item.Root>
      {:else}
        <Button size="lg" onclick={openDialog}>
          <KeyIcon class="size-4" />
          Connect Provider
        </Button>
      {/if}
    </Empty.Content>
  </Empty.Root>
</main>

{#if open}
  <ConnectProviderDialog bind:open />
{/if}
