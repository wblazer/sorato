<script lang="ts">
  import { tick } from 'svelte'
  import { useId } from 'bits-ui'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Command from '$lib/components/ui/command/index.js'
  import * as Popover from '$lib/components/ui/popover/index.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import type { Project } from '$lib/types.js'
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'
  import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'

  interface Props {
    projects: ReadonlyArray<Project>
    value: string | null
    loading?: boolean
    disabled?: boolean
    onChange?: (value: string) => void
  }

  let {
    projects,
    value,
    loading = false,
    disabled = false,
    onChange,
  }: Props = $props()

  let open = $state(false)
  let triggerRef: HTMLButtonElement | null = $state(null)
  const listboxId = useId()

  const selectedProject = $derived(
    projects.find((project) => project.id === value) ?? null
  )

  function closeAndFocusTrigger() {
    open = false
    tick().then(() => triggerRef?.focus())
  }

  function selectProject(id: string) {
    onChange?.(id)
    closeAndFocusTrigger()
  }

  function addProject() {
    open = false
    queueMicrotask(() => actionStore.trigger('project.add'))
  }

  function filterProject(
    itemValue: string,
    search: string,
    keywords: Array<string> = []
  ) {
    const query = search.trim().toLowerCase()
    if (!query) return 1

    const haystack = [itemValue, ...keywords].join(' ').toLowerCase()
    const terms = query.split(/\s+/)
    return terms.every((term) => haystack.includes(term)) ? 1 : 0
  }

  const triggerLabel = $derived.by(() => {
    if (loading) return 'Loading projects...'
    if (selectedProject) return selectedProject.name
    if (projects.length === 0) return 'No projects'
    return 'Select project'
  })
</script>

<Popover.Root bind:open>
  <Popover.Trigger bind:ref={triggerRef}>
    <Button
      type="button"
      variant="outline"
      size="lg"
      class="h-14 w-full justify-between gap-3 px-4 text-left text-base"
      role="combobox"
      aria-controls={listboxId}
      aria-expanded={open}
      {disabled}
    >
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <FolderOpenIcon class="size-5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{triggerLabel}</span>
          {#if selectedProject}
            <span class="block truncate text-sm font-normal text-muted-foreground">
              {selectedProject.path}
            </span>
          {/if}
        </span>
      </span>
      <CaretDownIcon class="shrink-0 text-muted-foreground" />
    </Button>
  </Popover.Trigger>

  <Popover.Content
    class="w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden p-1.5"
    align="center"
  >
    <Command.Root class="rounded-lg p-0" filter={filterProject}>
      <Command.Input placeholder="Search projects..." />
      <Command.List id={listboxId} class="h-60 px-1 pt-1.5 pb-1">
        {#if loading}
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading projects...
          </div>
        {:else}
          <Command.Empty>No projects found.</Command.Empty>

          {#each projects as project (project.id)}
            <Command.Item
              value={`${project.name} ${project.path}`}
              keywords={[project.path]}
              onSelect={() => selectProject(project.id)}
            >
              <FolderOpenIcon class="text-muted-foreground" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{project.name}</span>
                <span class="block truncate text-xs text-muted-foreground">
                  {project.path}
                </span>
              </span>
            </Command.Item>
          {/each}
        {/if}
      </Command.List>
      <div class="border-t px-1 pt-1">
        <Command.Item value="new add project local folder" onSelect={addProject}>
          <PlusIcon class="text-muted-foreground" />
          <span class="truncate">New Project</span>
        </Command.Item>
      </div>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
