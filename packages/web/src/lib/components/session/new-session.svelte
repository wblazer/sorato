<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { searchProjectFiles } from '$lib/project-file-search.js'
  import Composer from './composer.svelte'
  import * as Item from '$lib/components/ui/item/index.js'
  import EmptySessionTreePanel from './empty-session-tree-panel.svelte'
  import SessionShell from './session-shell.svelte'
  import ProjectSelector from './project-selector.svelte'
  import SessionSearchDialog from './session-search-dialog.svelte'
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  import {
    selectedHeadStorageKey,
    writeSelectedHead,
  } from '$lib/selected-head-storage.js'
  import {
    composerDraftStorageKey,
    composerHistoryStorageKey,
    writeComposerDraft,
    writeComposerDraftAttachments,
  } from '$lib/composer-storage.js'
  import { Effect } from 'effect'
  import type { ModelOptions, RunAttachment } from '$lib/types.js'

  let sending = $state(false)
  let sessionSearchOpen = $state(false)

  const activeProjectId = $derived(
    tabStore.activeTab?.projectId ?? projectStore.selectedProjectId,
  )
  const draftStorageKey = $derived(
    composerDraftStorageKey(
      connectionsStore.activeConnectionScopeId,
      tabStore.activeTab?.id,
    ),
  )
  const historyStorageKey = $derived(
    composerHistoryStorageKey(connectionsStore.activeConnectionScopeId),
  )
  function handleModel(value: string, options?: ModelOptions) {
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
      .sort((a, b) => b.timestamp - a.timestamp),
  )

  const recentSessions = $derived(sessionOptions.slice(0, 6))

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    const justNow = 'just now'
    if (seconds < 60) return justNow
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  function handleProject(projectId: string) {
    const tabId = tabStore.activeTab?.id
    if (!tabId) return

    tabStore.setDraftProject(tabId, projectId)
    void Effect.runPromise(modelsStore.load(projectId))
  }

  function openSession(sessionId: string) {
    sessionStore.selectSession(sessionId)
    sessionSearchOpen = false
  }

  function handleAttach() {}

  async function searchFiles(query: string) {
    if (!activeProjectId) return []
    return await Effect.runPromise(searchProjectFiles(activeProjectId, query))
  }

  function retryModels() {
    if (activeProjectId)
      void Effect.runPromise(modelsStore.load(activeProjectId))
  }

  async function handleSend(
    input: string,
    attachments: ReadonlyArray<RunAttachment>,
  ): Promise<boolean> {
    if (sending || !activeProjectId) return false
    const tabId = tabStore.activeTab?.id
    if (!tabId) return false

    sending = true

    try {
      if (modelsStore.projectId !== activeProjectId || modelsStore.loading) {
        await Effect.runPromise(modelsStore.load(activeProjectId))
      }

      const model = modelsStore.selectedModel
      if (!model) return false

      const session = await Effect.runPromise(
        sessionStore.createSession(activeProjectId, null),
      )
      if (!session) return false

      messagesStore.prepareSession(tabId, session.id)

      const response = await Effect.runPromise(
        sessionStore.runAgent(
          session.id,
          input,
          attachments,
          model,
          null,
          null,
          modelsStore.selectedOptions,
        ),
      )
      if (!response) return false

      writeComposerDraft(draftStorageKey, '')
      writeComposerDraftAttachments(draftStorageKey, [])
      tabStore.attachSession(tabId, session)

      writeSelectedHead(
        selectedHeadStorageKey(
          connectionsStore.activeConnectionScopeId,
          session.id,
          tabId,
        ),
        { type: 'run', runId: response.runId, baseNodeId: response.baseNodeId },
      )
      messagesStore.addOptimisticUserMessage(
        tabId,
        session.id,
        input,
        attachments,
        response.baseNodeId,
        response.runId,
      )
      return true
    } finally {
      sending = false
    }
  }
</script>

<SessionSearchDialog bind:open={sessionSearchOpen} />

<SessionShell title="New Session">
  {#snippet panel()}
    <EmptySessionTreePanel />
  {/snippet}

  <div
    class="new-session-stage mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center"
  >
    <div
      class="new-session-content flex w-full flex-col items-center gap-10 px-6 py-6"
    >
      {#if sessionStore.sessions.length > 0}
        <div class="w-full max-w-md space-y-2">
          <div class="text-center text-base font-medium text-muted-foreground">
            Resume a session
          </div>

          <div class="space-y-5">
            <div class="flex justify-center">
              <Button
                variant="outline"
                onclick={() => (sessionSearchOpen = true)}
              >
                <MagnifyingGlassIcon />
                Search sessions
              </Button>
            </div>

            <div class="new-session-recent space-y-1">
              <div class="px-2 text-sm font-medium text-muted-foreground">
                Recent Sessions
              </div>

              {#each recentSessions as item (item.session.id)}
                <button
                  type="button"
                  class="new-session-recent-item flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-2 text-left text-base outline-hidden select-none hover:bg-base-hover"
                  onclick={() => openSession(item.session.id)}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-base">{item.title}</span>
                    <span class="block truncate text-sm text-muted-foreground">
                      {item.project?.name ?? 'Unknown project'}
                    </span>
                  </span>
                  <span class="ml-3 shrink-0 text-sm text-muted-foreground">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div
          class="flex w-full max-w-sm items-center gap-3 text-sm font-medium text-muted-foreground"
        >
          <div class="h-px flex-1 bg-border"></div>
          <span>or</span>
          <div class="h-px flex-1 bg-border"></div>
        </div>
      {/if}

      <div class="w-full max-w-sm space-y-2 text-center">
        <div class="text-base font-medium text-muted-foreground">
          Start session in
        </div>
        <ProjectSelector
          projects={projectStore.projects}
          value={activeProjectId}
          loading={projectStore.loading}
          onChange={handleProject}
        />

        {#if modelsStore.error}
          <Item.Root variant="danger" size="sm" class="text-left">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>Models failed to load</Item.Title>
              <Item.Description>{modelsStore.error}</Item.Description>
            </Item.Content>
            <Item.Actions>
              <Button variant="outline" onclick={retryModels}>Retry</Button>
            </Item.Actions>
          </Item.Root>
        {:else if activeProjectId && !modelsStore.loading && modelsStore.models.length === 0}
          <Item.Root variant="danger" size="sm" class="text-left">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>No models available</Item.Title>
              <Item.Description
                >Connect provider credentials or choose a different project.</Item.Description
              >
            </Item.Content>
          </Item.Root>
        {/if}
      </div>
    </div>
  </div>

  <Composer
    onSend={handleSend}
    onAttach={handleAttach}
    onFileSearch={searchFiles}
    onModelChange={handleModel}
    {draftStorageKey}
    {historyStorageKey}
    models={modelsStore.models}
    model={modelsStore.selectedModel}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    modelDisabled={sending || !activeProjectId}
    disabled={sending || !modelsStore.selectedModel || !activeProjectId}
    autoFocus
    focusKey={tabStore.activeTabId}
    placeholder={activeProjectId
      ? sending
        ? 'Creating session...'
        : 'What would you like to do?'
      : 'Choose a project to start'}
  />
</SessionShell>

<style>
  .new-session-stage {
    container: new-session-stage / size;
  }

  @container new-session-stage (max-height: 42rem) {
    .new-session-content {
      padding-block: 1rem;
      gap: 1.75rem;
    }

    .new-session-recent-item:nth-of-type(n + 5) {
      display: none;
    }
  }

  @container new-session-stage (max-height: 36rem) {
    .new-session-content {
      gap: 1.25rem;
    }

    .new-session-recent-item:nth-of-type(n + 3) {
      display: none;
    }
  }

  @container new-session-stage (max-height: 30rem) {
    .new-session-recent {
      display: none;
    }
  }
</style>
