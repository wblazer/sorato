<script lang="ts">
  import DirectoryPicker from '$lib/components/directory-picker.svelte'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { actionStore } from '$lib/stores/actions.svelte.js'
      import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon'
      import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'
      import { cn } from '$lib/utils.js'
      import { onMount } from 'svelte'

      let open = $state(false)
      let pickerOpen = $state(false)
      let triggerEl: HTMLButtonElement | null = $state(null)

      const directoryName = $derived(
        sessionStore.selectedDirectory.split('/').pop() ?? ''
      )

      function handleWindowClick(e: MouseEvent) {
        if (triggerEl && !triggerEl.contains(e.target as Node)) {
          open = false
        }
      }

      function selectDirectory(dir: string) {
        sessionStore.selectDirectory(dir)
        open = false
      }

      function toggleOpen() {
        open = !open
      }

      function handleOpenDirectory() {
        open = false
        actionStore.trigger('directory.open')
      }

      function handlePickerSelect(path: string) {
        sessionStore.openDirectory(path)
      }

      function directoryButtonClass(isSelected: boolean) {
        return cn(
          'flex w-full flex-col rounded-sm px-2.5 py-2 text-left transition-colors',
          isSelected ? 'bg-surface-hover text-foreground' : 'hover:bg-surface-hover'
        )
      }

      function itemDirectoryName(dir: string) {
        return dir.split('/').pop() ?? ''
      }

      onMount(() => {
        return actionStore.register({
          id: 'directory.open',
          title: 'Open Directory...',
          category: 'Sessions',
          description: 'Browse for a directory and switch the sidebar to it.',
          keywords: ['folder', 'project', 'workspace'],
          run: () => {
            pickerOpen = true
          },
        })
      })
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative" data-slot="directory-selector">
  <button
    type="button"
    bind:this={triggerEl}
    class={cn(
      'flex w-full items-center gap-3 rounded-md px-3 py-2.5',
       'hover:bg-surface-hover transition-colors',
      'text-left'
    )}
    onclick={toggleOpen}
  >
    <div class="min-w-0 flex-1">
      {#if sessionStore.selectedDirectory}
        <div class="truncate text-sm font-semibold text-foreground">
          {directoryName}
        </div>
        <div class="truncate text-xs text-muted-foreground">
          {sessionStore.selectedDirectory}
        </div>
      {:else}
        <div class="text-sm text-muted-foreground">No directory selected</div>
      {/if}
    </div>
    <CaretUpDownIcon
      class={cn('size-4 shrink-0 text-muted-foreground transition-transform')}
    />
  </button>

  {#if open}
    <div
      class={cn(
        'absolute top-full left-0 z-50 mt-1 w-full',
        'rounded-md border bg-surface-elevated p-1 shadow-md',
        'animate-in fade-in-0 zoom-in-95'
      )}
    >
      {#each sessionStore.directories as dir}
        <button
          type="button"
          class={directoryButtonClass(dir === sessionStore.selectedDirectory)}
          onclick={() => selectDirectory(dir)}
        >
          <span class="truncate text-sm font-medium">{itemDirectoryName(dir)}</span>
          <span class="truncate text-xs text-muted-foreground">{dir}</span>
        </button>
      {/each}

      <div class="my-1 h-px bg-border"></div>

      <button
        type="button"
        class={cn(
          'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors',
          'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
        )}
        onclick={handleOpenDirectory}
      >
        <FolderOpenIcon class="size-4" />
        Open Directory…
      </button>
    </div>
  {/if}
</div>

{#if pickerOpen}
  <DirectoryPicker bind:open={pickerOpen} onSelect={handlePickerSelect} />
{/if}
