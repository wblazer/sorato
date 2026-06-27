<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Empty from '$lib/components/ui/empty/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { Effect } from 'effect'
  import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
</script>

<main class="flex h-full items-center justify-center px-6 py-10">
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon">
        <FolderOpenIcon />
      </Empty.Media>
      {#if projectStore.error}
        <Empty.Title>Couldn’t load projects</Empty.Title>
        <Empty.Description>
          Sorato couldn’t check the server workspace list. Retry before adding a
          project.
        </Empty.Description>
      {:else}
        <Empty.Title>Add a project</Empty.Title>
        <Empty.Description>
          Projects are durable server workspaces. For now, a project is a local
          directory.
        </Empty.Description>
      {/if}
    </Empty.Header>

    <Empty.Content>
      {#if projectStore.loading}
        <p class="text-sm text-muted-foreground">Loading projects…</p>
      {:else if projectStore.error}
        <Item.Root variant="danger" class="max-w-lg text-left">
          <Item.Media variant="icon">
            <WarningCircleIcon />
          </Item.Media>
          <Item.Content>
            <Item.Title>Projects failed to load</Item.Title>
            <Item.Description>{projectStore.error}</Item.Description>
          </Item.Content>
          <Item.Actions>
            <Button
              variant="outline"
              onclick={() =>
                void Effect.runPromise(projectStore.fetchProjects())}
            >
              Retry
            </Button>
          </Item.Actions>
        </Item.Root>
      {:else}
        <Button size="lg" onclick={() => actionStore.trigger('project.add')}>
          <PlusIcon />
          Add Project
        </Button>
      {/if}
    </Empty.Content>
  </Empty.Root>
</main>
