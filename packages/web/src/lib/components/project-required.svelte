<script lang="ts">
  import DirectoryPicker from '$lib/components/directory-picker.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Empty from '$lib/components/ui/empty/index.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'

  let pickerOpen = $state(false)

  function handlePickerSelect(path: string) {
    void projectStore.createLocalProject(path)
  }
</script>

<main class="flex h-full items-center justify-center px-6 py-10">
  <Empty.Root class="max-w-2xl gap-6 border-0 p-8 sm:p-12">
    <Empty.Header class="max-w-lg gap-2">
      <Empty.Media variant="icon" class="mb-3 size-12 [&_svg:not([class*='size-'])]:size-6">
        <FolderOpenIcon class="size-6" />
      </Empty.Media>
      <Empty.Title class="text-lg">Add a project</Empty.Title>
      <Empty.Description class="text-sm">
        Projects are durable server workspaces. For now, a project is a local directory.
      </Empty.Description>
    </Empty.Header>

    <Empty.Content class="gap-3">
      {#if projectStore.loading}
        <p class="text-sm text-muted-foreground">Loading projects…</p>
      {:else if projectStore.error}
        <p class="text-sm text-danger">{projectStore.error}</p>
      {/if}

      <Button size="lg" onclick={() => (pickerOpen = true)}>
        <FolderOpenIcon class="size-4" />
        Open Project
      </Button>
    </Empty.Content>
  </Empty.Root>
</main>

{#if pickerOpen}
  <DirectoryPicker bind:open={pickerOpen} onSelect={handlePickerSelect} />
{/if}
