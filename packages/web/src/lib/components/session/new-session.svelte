<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { searchProjectFiles } from '$lib/project-file-search.js'
  import { runConnectionPromise } from '$lib/connection-runtime.js'
  import Composer from './composer.svelte'
  import * as Item from '$lib/components/ui/item/index.js'
  import EmptySessionTreePanel from './empty-session-tree-panel.svelte'
  import SessionShell from './session-shell.svelte'
  import ProjectSelector from './project-selector.svelte'
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
  import type { ModelOptions, RunAttachment } from '$lib/types.js'

  let sending = $state(false)

  const activeProjectId = $derived(projectStore.selectedProjectId)
  const draftStorageKey = $derived(
    composerDraftStorageKey(
      connectionsStore.activeConnectionScopeId,
      'new-session',
    ),
  )
  const historyStorageKey = $derived(
    composerHistoryStorageKey(connectionsStore.activeConnectionScopeId),
  )
  function handleModel(value: string, options?: ModelOptions) {
    modelsStore.select(value, options)
  }

  function handleScenario(value: string) {
    modelsStore.selectScenario(value)
  }

  function handleSelectionKind(kind: 'model' | 'scenario') {
    modelsStore.setSelectionKind(kind)
  }

  function handleProject(projectId: string) {
    projectStore.selectProject(projectId)
  }

  function handleAttach() {}

  async function searchFiles(query: string) {
    if (!activeProjectId) return []
    return await runConnectionPromise(
      searchProjectFiles(activeProjectId, query),
    )
  }

  function retryModels() {
    if (activeProjectId)
      void runConnectionPromise(modelsStore.load(activeProjectId))
  }

  async function handleSend(
    input: string,
    attachments: ReadonlyArray<RunAttachment>,
  ): Promise<boolean> {
    if (sending || !activeProjectId) return false

    sending = true

    try {
      if (modelsStore.projectId !== activeProjectId || modelsStore.loading) {
        await runConnectionPromise(modelsStore.load(activeProjectId))
      }

      const model = modelsStore.selectedTargetId
      if (!model) return false

      const session = await runConnectionPromise(
        sessionStore.createSession(activeProjectId),
      )
      if (!session) return false

      messagesStore.prepareSession(session.id)

      const response = await runConnectionPromise(
        sessionStore.runAgent(
          session.id,
          input,
          attachments,
          model,
          null,
          null,
          modelsStore.selectedTargetOptions,
        ),
      )
      if (!response) return false

      writeComposerDraft(draftStorageKey, '')
      writeComposerDraftAttachments(draftStorageKey, [])

      writeSelectedHead(
        selectedHeadStorageKey(
          connectionsStore.activeConnectionScopeId,
          session.id,
        ),
        { type: 'run', runId: response.runId, baseNodeId: response.baseNodeId },
      )
      messagesStore.addOptimisticUserMessage(
        session.id,
        input,
        attachments,
        response.baseNodeId,
        response.runId,
      )
      sessionStore.selectSession(session.id, { loadMessages: false })
      return true
    } finally {
      sending = false
    }
  }
</script>

<SessionShell title="New Session">
  {#snippet panel()}
    <EmptySessionTreePanel />
  {/snippet}

  <div
    class="new-session-stage mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center"
  >
    <div class="flex w-full flex-col items-center gap-6 px-6 py-6">
      <div class="w-full max-w-sm space-y-2 text-center">
        <h2 class="text-xl font-semibold text-foreground">
          Start a new session
        </h2>
        <p class="pb-2 text-sm text-muted-foreground">Choose a project</p>
        <ProjectSelector
          projects={projectStore.projects}
          value={activeProjectId}
          loading={projectStore.loading}
          onChange={handleProject}
        />

        {#if modelsStore.error && modelsStore.selectionKind === 'model'}
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
        {:else if activeProjectId && !modelsStore.loading && modelsStore.models.length === 0 && modelsStore.selectionKind === 'model'}
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
    onScenarioChange={handleScenario}
    onSelectionKindChange={handleSelectionKind}
    {draftStorageKey}
    {historyStorageKey}
    models={modelsStore.models}
    scenarios={modelsStore.scenarios}
    model={modelsStore.selectedModel}
    scenario={modelsStore.selectedScenario}
    selectionKind={modelsStore.selectionKind}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    modelDisabled={sending || !activeProjectId}
    disabled={sending || !activeProjectId}
    autoFocus
    focusKey="new-session"
    placeholder={activeProjectId
      ? sending
        ? 'Creating session...'
        : 'What would you like to do?'
      : 'Choose a project to start'}
  />
</SessionShell>
