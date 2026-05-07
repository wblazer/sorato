<script lang="ts">
  import DirectoryPicker from '$lib/components/directory-picker.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Empty from '$lib/components/ui/empty/index.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'

  let pickerOpen = $state(false)

  function handlePickerSelect(path: string) {
    sessionStore.openDirectory(path)
  }
</script>

<main class="flex h-full items-center justify-center px-6 py-10">
  <Empty.Root class="max-w-2xl gap-6 border-0 p-8 sm:p-12">
    <Empty.Header class="max-w-lg gap-2">
      <Empty.Media variant="icon" class="mb-3 size-12 [&_svg:not([class*='size-'])]:size-6">
        <FolderOpenIcon class="size-6" />
      </Empty.Media>
      <Empty.Title class="text-lg">Select a directory</Empty.Title>
      <Empty.Description class="text-sm">
        Sessions are scoped to a project directory so tools and model context
        have a concrete workspace.
      </Empty.Description>
    </Empty.Header>

    <Empty.Content>
      <Button size="lg" onclick={() => (pickerOpen = true)}>
        <FolderOpenIcon class="size-4" />
        Open Directory
      </Button>
    </Empty.Content>
  </Empty.Root>
</main>

{#if pickerOpen}
  <DirectoryPicker bind:open={pickerOpen} onSelect={handlePickerSelect} />
{/if}
