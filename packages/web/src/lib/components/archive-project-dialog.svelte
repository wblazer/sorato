<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Checkbox from '$lib/components/ui/checkbox/index.js'
  import * as Command from '$lib/components/ui/command/index.js'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon'

  interface Props {
    open: boolean
  }

  let { open = $bindable(false) }: Props = $props()

  let selectedProjectId = $state<string | null>(null)
  let archiveSessions = $state(true)
  let archiving = $state(false)
  let error = $state<string | null>(null)

  const selectedProject = $derived(projectStore.getProject(selectedProjectId))
  const selectedProjectSessionCount = $derived(
    selectedProjectId
      ? sessionStore.sessions.filter(
          (session) => session.projectId === selectedProjectId
        ).length
      : 0
  )

  $effect(() => {
    if (!open) {
      selectedProjectId = null
      archiveSessions = true
      archiving = false
      error = null
    }
  })

  function sessionCount(projectId: string): number {
    return sessionStore.sessions.filter((session) => session.projectId === projectId)
      .length
  }

  async function archiveProject(projectId: string, includeSessions: boolean) {
    if (archiving) return
    archiving = true
    error = null
    try {
      const ok = await projectStore.archiveProject(projectId, includeSessions)
      if (ok) {
        tabStore.clearProject(projectId)
        await sessionStore.fetchSessions()
        open = false
      }
    } finally {
      archiving = false
    }
  }

  function chooseProject(projectId: string) {
    if (sessionCount(projectId) === 0) {
      void archiveProject(projectId, false)
      return
    }

    selectedProjectId = projectId
    archiveSessions = true
    error = null
  }

  async function archiveSelectedProject() {
    if (!selectedProjectId) return
    await archiveProject(selectedProjectId, archiveSessions)
  }
</script>

<Dialog.Dialog bind:open>
  <Dialog.DialogContent class="bg-popover sm:max-w-md">
    <Dialog.DialogHeader>
      <Dialog.DialogTitle>
        {selectedProject ? 'Archive Project' : 'Choose Project to Archive'}
      </Dialog.DialogTitle>
      <Dialog.DialogDescription>
        {#if selectedProject}
          This hides the project from project selectors. Files on disk are not changed.
        {:else}
          Choose a project to hide from Sorato.
        {/if}
      </Dialog.DialogDescription>
    </Dialog.DialogHeader>

    {#if !selectedProject}
      <Command.Root class="gap-2 overflow-visible rounded-none bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0">
        <Command.Input placeholder="Search projects..." />
        <Command.List class="max-h-72 px-0 pb-0">
          <Command.Empty>No projects found.</Command.Empty>
          {#each projectStore.projects as project (project.id)}
            <Command.Item
              class="px-2 py-2 text-sm"
              value={`${project.name} ${project.path}`}
              keywords={[project.path]}
              onSelect={() => chooseProject(project.id)}
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
        </Command.List>
        {#if error || projectStore.error}
          <p class="text-sm text-danger">{error ?? projectStore.error}</p>
        {/if}
      </Command.Root>
    {:else}
      <div class="space-y-4">
        <div class="rounded-lg border border-border p-3">
          <div class="truncate text-sm font-medium text-foreground">
            {selectedProject.name}
          </div>
          <div class="truncate text-xs text-muted-foreground">
            {selectedProject.path}
          </div>
        </div>

        <label class="flex items-start gap-3 rounded-lg border border-border p-3">
          <Checkbox.Root bind:checked={archiveSessions} />
          <span class="space-y-1 text-left">
            <span class="block text-sm font-medium text-foreground">
              Also archive sessions in this project
            </span>
            <span class="block text-xs text-muted-foreground">
              {selectedProjectSessionCount} active {selectedProjectSessionCount === 1 ? 'session' : 'sessions'} will be hidden from session search.
            </span>
          </span>
        </label>

        {#if error || projectStore.error}
          <p class="text-sm text-danger">{error ?? projectStore.error}</p>
        {/if}
      </div>

      <Dialog.DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onclick={() => {
            selectedProjectId = null
            error = null
          }}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={archiving}
          onclick={() => void archiveSelectedProject()}
        >
          {archiving ? 'Archiving...' : 'Archive Project'}
        </Button>
      </Dialog.DialogFooter>
    {/if}
  </Dialog.DialogContent>
</Dialog.Dialog>
