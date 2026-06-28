<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import LoadingState from '$lib/components/loading-state.svelte'
  import { MessageScrollerController } from '$lib/components/message-scroller/message-scroller.svelte.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { searchProjectFiles } from '$lib/project-file-search.js'
  import {
    composerDraftStorageKey,
    composerHistoryStorageKey,
  } from '$lib/composer-storage.js'
  import type { MessageNode, ModelCall } from '$lib/types.js'
  import {
    persistedSources,
    projectTranscript,
    type TranscriptItem,
  } from '$lib/transcript.js'
  import MessageBubble from './message-bubble.svelte'
  import QueuedMessageBubble from './queued-message-bubble.svelte'
  import StreamingIndicator from './streaming-indicator.svelte'
  import Composer from './composer.svelte'
  import SessionShell from './session-shell.svelte'
  import SessionTreePanel from './session-tree-panel.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { SessionSelectedHeadController } from './session-selected-head.svelte.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import { Effect } from 'effect'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  let {
    tabId,
    sessionId,
    title,
    active = true,
  }: {
    tabId: string
    sessionId: string
    title: string | null
    active?: boolean
  } = $props()

  const selectedHead = new SessionSelectedHeadController(
    () => tabId,
    () => sessionId,
    () => active,
  )
  const scroller = new MessageScrollerController({
    autoScroll: true,
    defaultScrollPosition: 'last-anchor',
    scrollEdgeThreshold: 80,
  })
  let initialScrollSessionId: string | null = null
  let accordionState = $state<Record<string, string[]>>({})
  let composerDraftText = $state('')
  let composerDraftKey = $state<string | null>(null)
  let viewportElement = $state<HTMLElement | null>(null)

  // Running state is derived from the session store — the single source
  // of truth. The messages store only tracks streaming *content*.
  const isRunning = $derived(sessionStore.isRunning(sessionId))
  const isStopping = $derived(sessionStore.isStopping(sessionId))
  const queuedMessages = $derived(sessionStore.queuedMessagesFor(sessionId))
  const sessionStatus = $derived(sessionStore.sessionStatus(sessionId))
  const selectedSession = $derived(
    sessionStore.sessions.find((item) => item.id === sessionId) ?? null,
  )
  const projectName = $derived.by(() => {
    const project = projectStore.getProject(selectedSession?.projectId ?? null)
    return project?.name ?? null
  })
  const visibleMessages = $derived(selectedHead.visibleMessages)
  const messagesLoading = $derived(messagesStore.loadingForTab(tabId))
  const messagesLoaded = $derived(messagesStore.loadedForTab(tabId))
  const messagesError = $derived(messagesStore.errorForTab(tabId))
  const selectedHeadValue = $derived(selectedHead.renderHead)
  const followedRun = $derived(
    selectedHeadValue?.type === 'run'
      ? sessionStore.activeRun(selectedHeadValue.runId)
      : null,
  )
  const isFollowingActiveRun = $derived(followedRun !== null)
  const followedStreamingParts = $derived(
    selectedHeadValue?.type === 'run' &&
      messagesStore.activeStreamTabId === tabId &&
      messagesStore.activeRunId === selectedHeadValue.runId
      ? messagesStore.streamingPartsForTab(tabId)
      : [],
  )
  const showStreamingIndicator = $derived(
    selectedHeadValue?.type === 'run' &&
      (isFollowingActiveRun || followedStreamingParts.length > 0),
  )
  const draftStorageKey = $derived(
    composerDraftStorageKey(connectionsStore.activeConnection?.id, tabId),
  )
  const historyStorageKey = $derived(
    composerHistoryStorageKey(connectionsStore.activeConnection?.id),
  )

  const persistedTranscriptItems = $derived.by(() =>
    projectTranscript(persistedSources(visibleMessages), {
      pretty: clientSettingsStore.prettyTranscript,
    }),
  )

  type MessageRenderBlock = {
    readonly key: string
    readonly message: MessageNode
    readonly items: ReadonlyArray<TranscriptItem>
    readonly modelCall: ModelCall | null
    readonly runId: string | null
  }

  type SessionVirtualRow =
    | {
        readonly type: 'message'
        readonly key: string
        readonly block: MessageRenderBlock
      }
    | {
        readonly type: 'streaming'
        readonly key: string
      }
    | {
        readonly type: 'queued'
        readonly key: string
        readonly message: (typeof queuedMessages)[number]
      }

  const transcriptSourceMessage = (
    item: TranscriptItem,
  ): MessageNode | null => {
    const source = item.type === 'combined-tool' ? item.callSource : item.source
    return source.type === 'persisted' ? source.message : null
  }

  const transcriptItemsForMessages = (
    messages: ReadonlyArray<MessageNode>,
  ): ReadonlyArray<TranscriptItem> =>
    persistedTranscriptItems.filter((item) => {
      const message = transcriptSourceMessage(item)
      return message !== null && messages.includes(message)
    })

  const messageBlocks = $derived.by((): ReadonlyArray<MessageRenderBlock> => {
    const blocks: MessageRenderBlock[] = []
    const messages = visibleMessages

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]

      if (
        message.encoded.role === 'assistant' ||
        message.encoded.role === 'tool'
      ) {
        const group = [message]
        let cursor = index + 1
        while (
          cursor < messages.length &&
          (messages[cursor].encoded.role === 'assistant' ||
            messages[cursor].encoded.role === 'tool')
        ) {
          group.push(messages[cursor])
          cursor++
        }

        blocks.push({
          key: group.map((groupMessage) => groupMessage.id).join(':'),
          message,
          items: transcriptItemsForMessages(group),
          modelCall:
            group
              .toReversed()
              .find((groupMessage) => groupMessage.modelCall !== null)
              ?.modelCall ?? null,
          runId: message.runId,
        })
        index = cursor - 1
        continue
      }

      blocks.push({
        key: message.id,
        message,
        items: transcriptItemsForMessages([message]),
        modelCall: message.modelCall,
        runId: message.runId,
      })
    }

    return blocks.map((block, index) => {
      if (block.runId === null) return block
      if (sessionStore.isRunActive(block.runId)) {
        return { ...block, modelCall: null }
      }

      const isLastBlockForRun = !blocks
        .slice(index + 1)
        .some((laterBlock) => laterBlock.runId === block.runId)
      return isLastBlockForRun ? block : { ...block, modelCall: null }
    })
  })

  const transcriptRows = $derived.by(
    (): ReadonlyArray<SessionVirtualRow> => [
      ...messageBlocks.map((block) => ({
        type: 'message' as const,
        key: `message:${block.key}`,
        block,
      })),
      ...(showStreamingIndicator
        ? [{ type: 'streaming' as const, key: 'streaming' }]
        : []),
      ...queuedMessages.map((message) => ({
        type: 'queued' as const,
        key: `queued:${message.id}`,
        message,
      })),
    ],
  )

  function jumpToLatest() {
    scroller.jumpToEnd()
  }

  function scrollToLatestAfterRender() {
    tick().then(() =>
      requestAnimationFrame(() => {
        scroller.jumpToEnd('auto')
      }),
    )
  }

  $effect(() => {
    if (!active) return
    if (!messagesLoaded && !messagesLoading) {
      void Effect.runPromise(messagesStore.loadMessages(tabId, sessionId))
    }
  })

  $effect(() => {
    const viewport = viewportElement
    if (!viewport) return

    viewport.setAttribute('role', 'region')
    viewport.setAttribute('aria-label', 'Messages')
    viewport.tabIndex = 0

    const binding = scroller.viewport(viewport as HTMLDivElement)

    return () => {
      binding.destroy()
      viewport.removeAttribute('role')
      viewport.removeAttribute('aria-label')
      viewport.removeAttribute('tabindex')
    }
  })

  $effect(() => {
    if (!active) return
    if (messagesLoading || transcriptRows.length === 0) return
    if (initialScrollSessionId === sessionId) return
    initialScrollSessionId = sessionId
    scrollToLatestAfterRender()
  })

  // Intentionally keep run heads as run heads after completion. Rendering a
  // run head follows the active run while it is streaming and resolves to
  // the latest persisted node for that run once inactive. This preserves
  // explicit node selection for mid-run history browsing.
  async function handleSend(input: string): Promise<boolean> {
    const model = modelsStore.selectedModel
    if (!model) return false

    const baseNodeId = selectedHead.selectedBaseNodeId
    const afterRunId = selectedHead.selectedAfterRunId
    const wasRunning = sessionStore.isRunning(sessionId)

    const response = await Effect.runPromise(
      sessionStore.runAgent(
        sessionId,
        input,
        model,
        baseNodeId,
        afterRunId,
        modelsStore.selectedOptions,
      ),
    )
    if (!response) return false
    if (response.status === 'queued') return true

    selectedHead.setSelectedHead({
      type: 'run',
      runId: response.runId,
      baseNodeId: response.baseNodeId,
    })

    if (!wasRunning) {
      // Show the user's message immediately — don't wait for the server
      // round-trip. The optimistic node is replaced on the next refresh.
      messagesStore.addOptimisticUserMessage(
        tabId,
        sessionId,
        input,
        response.baseNodeId,
        response.runId,
      )
    }

    return true
  }

  function handleStop() {
    void Effect.runPromise(sessionStore.stopAgent(sessionId))
  }

  function handleModel(value: string, modelOptions = {}) {
    modelsStore.select(value, modelOptions)
  }

  function handleAttach() {}

  async function searchFiles(query: string) {
    const projectId = selectedSession?.projectId
    if (!projectId) return []
    return await Effect.runPromise(searchProjectFiles(projectId, query))
  }

  function handleEditRetry(message: MessageNode, text: string) {
    selectedHead.setSelectedHead(
      message.parentId === null
        ? null
        : {
            type: 'node',
            nodeId: message.parentId,
          },
    )
    composerDraftText = text
    composerDraftKey = `${message.id}:${Date.now()}`
  }

  function handleDismissError() {
    sessionStore.clearSessionError(sessionId)
  }

  function retryMessages() {
    void Effect.runPromise(
      messagesStore.loadMessages(tabId, sessionId, { force: true }),
    )
  }

  onDestroy(() => scroller.destroy())
</script>

<SessionShell title={title ?? 'New Session'}>
  {#snippet headerMeta()}
    {#if projectName}
      <Badge variant="secondary" class="h-6 max-w-56 truncate px-2.5 text-xs">
        {projectName}
      </Badge>
    {/if}
  {/snippet}

  {#snippet panel()}
    <SessionTreePanel
      {tabId}
      {sessionId}
      {selectedHead}
      model={modelsStore.selectedModel}
    />
  {/snippet}

  <div class="relative min-h-0 flex-1 overflow-hidden">
    <div
      use:scroller.root
      class="relative flex h-full flex-col overflow-hidden"
    >
      <ScrollArea
        bind:viewportRef={viewportElement}
        orientation="vertical"
        class="mr-0.5 h-full"
        viewportClass="scroll-mask-y scroll-mask-y-from-98% outline-none"
      >
        {#if messagesLoading}
          <LoadingState />
        {:else if messagesError}
          <div
            class="mx-auto flex w-full max-w-6xl items-center justify-center p-8"
          >
            <Item.Root variant="danger" class="max-w-xl">
              <Item.Media variant="icon">
                <WarningCircleIcon />
              </Item.Media>
              <Item.Content>
                <Item.Title>Messages failed to load</Item.Title>
                <Item.Description>{messagesError}</Item.Description>
              </Item.Content>
              <Item.Actions>
                <Button variant="outline" onclick={retryMessages}>Retry</Button>
              </Item.Actions>
            </Item.Root>
          </div>
        {:else if messagesLoaded || isRunning}
          <div
            use:scroller.content
            role="log"
            aria-relevant="additions"
            aria-busy={isRunning}
            class="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-1 px-4 py-5 sm:px-6"
          >
            {#each transcriptRows as row (row.key)}
              <div
                use:scroller.item={{
                  messageId: row.key,
                  scrollAnchor:
                    row.type === 'message' &&
                    row.block.message.encoded.role === 'user',
                }}
                class="[contain-intrinsic-size:0_160px] [content-visibility:auto]"
              >
                {#if row.type === 'message'}
                  <MessageBubble
                    message={row.block.message}
                    transcriptItems={row.block.items}
                    modelCall={row.block.modelCall}
                    {accordionState}
                    accordionKey={row.key}
                    onEditRetry={handleEditRetry}
                  />
                {:else if row.type === 'streaming'}
                  <StreamingIndicator
                    parts={followedStreamingParts}
                    isRunning={isFollowingActiveRun}
                    variant={followedRun?.kind === 'summary'
                      ? 'system'
                      : 'assistant'}
                    {accordionState}
                    accordionKey={row.key}
                  />
                {:else}
                  <QueuedMessageBubble message={row.message} />
                {/if}
              </div>
            {/each}
            <div
              use:scroller.spacer
              aria-hidden="true"
              data-message-scroller-spacer=""
              hidden
            ></div>
          </div>
        {/if}
      </ScrollArea>
    </div>

    {#if scroller.canScrollToEnd}
      <div
        class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center"
      >
        <Button
          class="pointer-events-auto shadow-md shadow-shadow/30"
          variant="outline"
          size="sm"
          onclick={jumpToLatest}
        >
          Jump to latest
        </Button>
      </div>
    {/if}
  </div>

  <Composer
    onSend={handleSend}
    onStop={handleStop}
    onAttach={handleAttach}
    onFileSearch={searchFiles}
    onDismissStatus={handleDismissError}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={modelsStore.selectedModel}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    {isRunning}
    {isStopping}
    autoFocus={active}
    focusKey={sessionId}
    {draftStorageKey}
    {historyStorageKey}
    draftText={composerDraftText}
    draftKey={composerDraftKey}
    {sessionStatus}
    tokenUsageMessages={visibleMessages}
    disabled={isStopping}
  />
</SessionShell>
