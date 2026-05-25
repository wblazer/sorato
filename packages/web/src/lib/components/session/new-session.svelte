<script lang="ts">
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import Composer from './composer.svelte'

  let sending = $state(false)

  const activeProjectId = $derived(
    tabStore.activeTab?.projectId ?? projectStore.selectedProjectId
  )
  const activeProject = $derived(projectStore.getProject(activeProjectId))

  function handleModel(value: string, options = {}) {
    modelsStore.select(value, options)
  }

  function handleProject(projectId: string) {
    sessionStore.selectProject(projectId)
  }

  function handleAttach() {}

  async function handleSend(input: string) {
    const model = modelsStore.selectedModel
    if (sending || !model || !activeProjectId) return
    sending = true

    try {
      const session = await sessionStore.createSession(activeProjectId)
      if (!session) return

      messagesStore.prepareSession(session.id)

      await sessionStore.runAgent(
        session.id,
        input,
        model,
        modelsStore.selectedOptions
      )
    } finally {
      sending = false
    }
  }
</script>

<div class="flex h-full flex-col">
  <div class="py-4">
    <div class="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div class="min-w-0 flex-1">
        <h1 class="text-sm font-semibold text-foreground">New Tab</h1>
        {#if activeProject}
          <span class="text-xs text-muted-foreground">
            {activeProject.name} — {activeProject.path}
          </span>
        {:else}
          <span class="text-xs text-muted-foreground">Choose a project to start a session.</span>
        {/if}
      </div>
    </div>
  </div>

  <div
    class="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center"
  >
    {#if projectStore.projects.length > 0}
      <div class="w-full max-w-md space-y-2 text-left">
        <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Project
        </div>
        <div class="space-y-1">
          {#each projectStore.projects.slice(0, 5) as project (project.id)}
            <button
              type="button"
              class="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-base-hover data-[selected=true]:bg-selected"
              data-selected={project.id === activeProjectId}
              onclick={() => handleProject(project.id)}
            >
              <span class="truncate text-sm font-medium">{project.name}</span>
              <span class="truncate text-xs text-muted-foreground">{project.path}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div>
      {#if modelsStore.error}
        <p class="text-xs text-danger">{modelsStore.error}</p>
      {:else if activeProjectId && !modelsStore.loading && modelsStore.models.length === 0}
        <p class="text-xs text-danger">No models available for this project.</p>
      {/if}
    </div>
  </div>

  <Composer
    onSend={handleSend}
    onAttach={handleAttach}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={modelsStore.selectedModel}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    modelDisabled={sending || !activeProjectId}
    disabled={sending || modelsStore.loading || !modelsStore.selectedModel || !activeProjectId}
    placeholder={activeProjectId ? (sending ? 'Creating session...' : 'What would you like to do?') : 'Choose a project to start'}
  />
</div>
