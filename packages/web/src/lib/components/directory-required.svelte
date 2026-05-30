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
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon">
        <FolderOpenIcon />
      </Empty.Media>
      <Empty.Title>Add a project</Empty.Title>
      <Empty.Description>
        Sessions are scoped to a project so tools and model context have a concrete workspace.
      </Empty.Description>
    </Empty.Header>

    <Empty.Content>
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
