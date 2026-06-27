<script lang="ts">
  import { tick } from 'svelte'
  import { get } from 'svelte/store'
  import { createVirtualizer } from '@tanstack/svelte-virtual'
  import LoadingState from '$lib/components/loading-state.svelte'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
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
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  let { sessionId, title }: { sessionId: string; title: string | null } =
    $props()

  const selectedHead = new SessionSelectedHeadController(() => sessionId)
  let messagesContainer: HTMLElement | null = $state(null)
  let isAtLatest = $state(true)
  let initialScrollSessionId: string | null = null
  let accordionSessionId: string | null = $state(null)
  let accordionState = $state<Record<string, string[]>>({})
  let composerDraftText = $state('')
  let composerDraftKey = $state<string | null>(null)

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
  const selectedHeadValue = $derived(selectedHead.renderHead)
  const followedRun = $derived(
    selectedHeadValue?.type === 'run'
      ? sessionStore.activeRun(selectedHeadValue.runId)
      : null,
  )
  const isFollowingActiveRun = $derived(followedRun !== null)
  const followedStreamingParts = $derived(
    selectedHeadValue?.type === 'run' &&
      messagesStore.activeRunId === selectedHeadValue.runId
      ? messagesStore.streamingParts
      : [],
  )
  const showStreamingIndicator = $derived(
    selectedHeadValue?.type === 'run' &&
      (isFollowingActiveRun || followedStreamingParts.length > 0),
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

      if (message.encoded.role === 'assistant') {
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

  const virtualRows = $derived.by(
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

  const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => messagesContainer,
    estimateSize: () => 160,
    getItemKey: (index) => virtualRows[index]?.key ?? index,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 80,
    overscan: 6,
    paddingStart: 20,
    paddingEnd: 20,
    gap: 4,
    onChange: (instance) => {
      isAtLatest = instance.isAtEnd(80)
    },
  })

  const virtualItems = $derived($virtualizer.getVirtualItems())

  function measureVirtualRow(node: HTMLDivElement) {
    get(virtualizer).measureElement(node)
  }

  function updateLatestState() {
    isAtLatest = get(virtualizer).isAtEnd(80)
  }

  function jumpToLatest() {
    get(virtualizer).scrollToEnd()
    updateLatestState()
  }

  function scrollToLatestAfterRender() {
    tick().then(() =>
      requestAnimationFrame(() => {
        get(virtualizer).scrollToEnd()
        updateLatestState()
      }),
    )
  }

  $effect(() => {
    if (messagesStore.currentSessionId !== sessionId) {
      void messagesStore.loadMessages(sessionId)
    }
  })

  $effect(() => {
    if (accordionSessionId === sessionId) return
    accordionSessionId = sessionId
    accordionState = {}
  })

  $effect(() => {
    get(virtualizer).setOptions({
      count: virtualRows.length,
      getScrollElement: () => messagesContainer,
      estimateSize: () => 160,
      getItemKey: (index) => virtualRows[index]?.key ?? index,
      anchorTo: 'end',
      followOnAppend: true,
      scrollEndThreshold: 80,
      overscan: 6,
      paddingStart: 20,
      paddingEnd: 20,
      gap: 4,
      onChange: (instance) => {
        isAtLatest = instance.isAtEnd(80)
      },
    })
  })

  $effect(() => {
    if (messagesStore.currentSessionId !== sessionId) return
    if (messagesStore.loading || virtualRows.length === 0) return
    if (initialScrollSessionId === sessionId) return
    initialScrollSessionId = sessionId
    scrollToLatestAfterRender()
  })

  // Intentionally keep run heads as run heads after completion. Rendering a
  // run head follows the active run while it is streaming and resolves to
  // the latest persisted node for that run once inactive. This preserves
  // explicit node selection for mid-run history browsing.
  function handleSend(input: string) {
    const model = modelsStore.selectedModel
    if (!model) return

    const baseNodeId = selectedHead.selectedBaseNodeId
    const afterRunId = selectedHead.selectedAfterRunId
    const wasRunning = sessionStore.isRunning(sessionId)

    scrollToLatestAfterRender()

    void sessionStore
      .runAgent(
        sessionId,
        input,
        model,
        baseNodeId,
        afterRunId,
        modelsStore.selectedOptions,
      )
      .then((response) => {
        if (!response) return
        if (response.status === 'queued') return

        selectedHead.setSelectedHead({
          type: 'run',
          runId: response.runId,
          baseNodeId: response.baseNodeId,
        })

        if (!wasRunning) {
          // Show the user's message immediately — don't wait for the server
          // round-trip. The optimistic node is replaced on the next refresh.
          messagesStore.addOptimisticUserMessage(
            sessionId,
            input,
            response.baseNodeId,
            response.runId,
          )
        }
      })
  }

  function handleStop() {
    sessionStore.stopAgent(sessionId)
  }

  function handleModel(value: string, modelOptions = {}) {
    modelsStore.select(value, modelOptions)
  }

  function handleAttach() {}

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
    void messagesStore.loadMessages(sessionId)
  }
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
      {sessionId}
      {selectedHead}
      model={modelsStore.selectedModel}
    />
  {/snippet}

  <div class="relative min-h-0 flex-1 overflow-hidden">
    <ScrollArea
      bind:viewportRef={messagesContainer}
      class="h-full"
      viewportClass="scroll-mask-y scroll-mask-y-from-98%"
      onViewportScroll={updateLatestState}
    >
      {#if messagesStore.loading}
        <LoadingState />
      {:else if messagesStore.error}
        <div
          class="mx-auto flex w-full max-w-6xl items-center justify-center p-8"
        >
          <Item.Root variant="danger" class="max-w-xl">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>Messages failed to load</Item.Title>
              <Item.Description>{messagesStore.error}</Item.Description>
            </Item.Content>
            <Item.Actions>
              <Button variant="outline" onclick={retryMessages}>Retry</Button>
            </Item.Actions>
          </Item.Root>
        </div>
      {:else if messagesStore.loaded || isRunning}
        <div
          class="mx-auto w-full max-w-6xl"
          style:height={`${$virtualizer.getTotalSize()}px`}
          style:position="relative"
        >
          {#each virtualItems as virtualItem (virtualItem.key)}
            {@const row = virtualRows[virtualItem.index]}
            {#if row}
              <div
                use:measureVirtualRow
                data-index={virtualItem.index}
                class="absolute left-0 top-0 w-full px-4 sm:px-6"
                style:transform={`translateY(${virtualItem.start}px)`}
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
            {/if}
          {/each}
        </div>
      {/if}
    </ScrollArea>

    {#if !isAtLatest}
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
    onDismissStatus={handleDismissError}
    onModelChange={handleModel}
    models={modelsStore.models}
    model={modelsStore.selectedModel}
    modelOptions={modelsStore.selectedOptions}
    modelLoading={modelsStore.loading}
    {isRunning}
    {isStopping}
    autoFocus
    focusKey={sessionId}
    draftText={composerDraftText}
    draftKey={composerDraftKey}
    {sessionStatus}
    tokenUsageMessages={visibleMessages}
    disabled={isStopping}
  />
</SessionShell>
