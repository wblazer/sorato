<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import Composer from './composer.svelte'
  import ProjectSelector from './project-selector.svelte'
  import SessionSearchDialog from './session-search-dialog.svelte'
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon'

  let sending = $state(false)
  let sessionSearchOpen = $state(false)

  const activeProjectId = $derived(
    tabStore.activeTab?.projectId ?? projectStore.selectedProjectId
  )
  function handleModel(value: string, options = {}) {
    modelsStore.select(value, options)
  }

  const sessionOptions = $derived.by(() =>
    sessionStore.sessions
      .map((session) => {
        const project = projectStore.getProject(session.projectId)
        const title = sessionStore.displayTitle(session)

        return {
          session,
          project,
          title,
          timestamp: session.lastUserMessageAt ?? session.updatedAt,
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp)
  )

  const recentSessions = $derived(sessionOptions.slice(0, 6))

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  function handleProject(projectId: string) {
    sessionStore.selectProject(projectId)
  }

  function openSession(sessionId: string) {
    sessionStore.selectSession(sessionId)
    sessionSearchOpen = false
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

<SessionSearchDialog bind:open={sessionSearchOpen} />

<div class="flex h-full flex-col">
  <div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center px-6 py-6">
    <div class="flex w-full flex-col items-center gap-10">
      <div class="w-full max-w-md space-y-2">
        <div class="text-center text-sm font-medium text-muted-foreground">
          Resume a session
        </div>

        <div class="space-y-5">
          <div class="flex justify-center">
            <Button
              variant="outline"
              size="lg"
              class="gap-2 text-sm"
              onclick={() => (sessionSearchOpen = true)}
            >
              <MagnifyingGlassIcon class="size-4" />
              Search sessions
            </Button>
          </div>

          <div class="space-y-1">
            <div class="px-2 text-xs font-medium text-muted-foreground">
              Recent Sessions
            </div>

            {#if sessionStore.loading && sessionStore.sessions.length === 0}
              <div class="px-3 py-6 text-center text-sm text-muted-foreground">
                Loading sessions...
              </div>
            {:else if recentSessions.length === 0}
              <div class="px-3 py-6 text-center text-sm text-muted-foreground">
                No recent sessions.
              </div>
            {:else}
              {#each recentSessions as item (item.session.id)}
                <button
                  type="button"
                  class="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-base-hover"
                  onclick={() => openSession(item.session.id)}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm">{item.title}</span>
                    <span class="block truncate text-xs text-muted-foreground">
                      {item.project?.name ?? 'Unknown project'}
                    </span>
                  </span>
                  <span class="ml-3 shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      </div>

      <div class="flex w-full max-w-sm items-center gap-3 text-xs font-medium text-muted-foreground">
        <div class="h-px flex-1 bg-border"></div>
        <span>or</span>
        <div class="h-px flex-1 bg-border"></div>
      </div>

      <div class="w-full max-w-sm space-y-2 text-center">
        <div class="text-sm font-medium text-muted-foreground">
          Start session in
        </div>
        <ProjectSelector
          projects={projectStore.projects}
          value={activeProjectId}
          loading={projectStore.loading}
          onChange={handleProject}
        />

        {#if modelsStore.error}
          <p class="text-xs text-danger">{modelsStore.error}</p>
        {:else if activeProjectId && !modelsStore.loading && modelsStore.models.length === 0}
          <p class="text-xs text-danger">No models available for this project.</p>
        {/if}
      </div>
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
    autoFocus
    focusKey={tabStore.activeTabId}
    placeholder={activeProjectId ? (sending ? 'Creating session...' : 'What would you like to do?') : 'Choose a project to start'}
  />
</div>
