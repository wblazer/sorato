<script lang="ts">
  import DirectoryPicker from '$lib/components/directory-picker.svelte'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon'
  import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'
  import { cn } from '$lib/utils.js'
  import { onMount } from 'svelte'

  let open = $state(false)
  let pickerOpen = $state(false)
  let triggerEl: HTMLButtonElement | null = $state(null)

  function handleWindowClick(e: MouseEvent) {
    if (triggerEl && !triggerEl.contains(e.target as Node)) open = false
  }

  function handlePickerSelect(path: string) {
    void projectStore.createLocalProject(path)
  }

  onMount(() => {
    return actionStore.register({
      id: 'project.add',
      title: 'Add Project...',
      category: 'Projects',
      description: 'Browse for a local directory and add it as a project.',
      keywords: ['folder', 'directory', 'workspace'],
      run: () => {
        pickerOpen = true
      },
    })
  })
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative" data-slot="project-selector">
  <button
    type="button"
    bind:this={triggerEl}
    class={cn(
      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 hover:bg-base-hover text-left',
    )}
    onclick={() => (open = !open)}
  >
    <div class="min-w-0 flex-1">
      {#if projectStore.selectedProject}
        <div class="truncate text-sm font-semibold text-foreground">
          {projectStore.selectedProject.name}
        </div>
        <div class="truncate text-xs text-muted-foreground">
          {projectStore.selectedProject.path}
        </div>
      {:else}
        <div class="text-sm text-muted-foreground">No project selected</div>
      {/if}
    </div>
    <CaretUpDownIcon class="size-4 shrink-0 text-muted-foreground" />
  </button>

  {#if open}
    <div
      class="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md shadow-shadow/40"
    >
      {#each projectStore.projects as project (project.id)}
        <button
          type="button"
          class={cn(
            'flex w-full flex-col rounded-sm px-2.5 py-2 text-left',
            project.id === projectStore.selectedProjectId
              ? 'bg-selected text-foreground'
              : 'hover:bg-base-hover',
          )}
          onclick={() => {
            sessionStore.selectProject(project.id)
            open = false
          }}
        >
          <span class="truncate text-sm font-medium">{project.name}</span>
          <span class="truncate text-xs text-muted-foreground"
            >{project.path}</span
          >
        </button>
      {/each}

      <div class="my-1 h-px bg-border"></div>

      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-base-hover hover:text-foreground"
        onclick={() => {
          open = false
          pickerOpen = true
        }}
      >
        <FolderOpenIcon class="size-4" />
        Add Project…
      </button>
    </div>
  {/if}
</div>

{#if pickerOpen}
  <DirectoryPicker bind:open={pickerOpen} onSelect={handlePickerSelect} />
{/if}
