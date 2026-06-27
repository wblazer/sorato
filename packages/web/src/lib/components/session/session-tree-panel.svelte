<script lang="ts">
  import LoadingState from '$lib/components/loading-state.svelte'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import type { SelectedHead } from '$lib/selected-head-storage.js'
  import type { MessageNode } from '$lib/types.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon'
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon'
  import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon'
  import UserIcon from 'phosphor-svelte/lib/UserIcon'
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon'
  import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon'
  import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon'
  import {
    buildMessageTree,
    messageNarrativePreview,
    messagePreview,
    isToolMessage,
    pathIdsForHead,
    runTreeNodeId,
    summarizeAssistantToolExchange,
    type MessageTreeNode,
  } from './session-tree.js'
  import type { SessionSelectedHeadController } from './session-selected-head.svelte.js'
  import { Effect } from 'effect'

  let {
    tabId,
    sessionId,
    selectedHead,
    model,
  }: {
    tabId: string
    sessionId: string
    selectedHead: SessionSelectedHeadController
    model: string | null
  } = $props()

  let activeTab = $state('tree')
  let compactMode = $state(false)
  let compactStartNodeId = $state<string | null>(null)
  let compactEndNodeId = $state<string | null>(null)
  let compactInstructions = $state('')

  type ActiveRun = ReturnType<typeof sessionStore.activeRunsFor>[number]
  type BranchConnector = 'middle' | 'last' | null
  type GutterMark = 'blank' | 'vertical' | 'middle' | 'last'

  interface TreeRowLayout {
    readonly structuralDepth: number
    readonly visualDepth: number
    readonly branchConnector: BranchConnector
    readonly branchGutters: ReadonlyArray<{
      readonly level: number
      readonly continues: boolean
    }>
  }

  type TreeRow =
    | ({
        readonly type: 'node'
        readonly id: string
        readonly message: MessageNode
        readonly targetNodeId: string
        readonly coveredNodeIds: ReadonlyArray<string>
        readonly childCount: number
        readonly toolCallCount: number
        readonly toolCallNames: ReadonlyArray<string>
        readonly unresolvedToolCallCount: number
        readonly canSelect: boolean
      } & TreeRowLayout)
    | ({
        readonly type: 'run'
        readonly id: string
        readonly run: ActiveRun
      } & TreeRowLayout)

  const messages = $derived(messagesStore.messagesForTab(tabId))
  const tree = $derived(buildMessageTree(messages))
  const activeRuns = $derived(sessionStore.activeRunsFor(sessionId))
  const selectedPathIds = $derived(
    pathIdsForHead(messages, selectedHead.renderHead),
  )
  const selectedHeadValue = $derived(selectedHead.renderHead)
  const rows = $derived.by(() => flattenRows(tree, activeRuns))
  const selectedPathRows = $derived.by(() =>
    selectedPath(messages, baseHeadNodeId),
  )
  const baseHeadNodeId = $derived.by(() =>
    selectedHeadValue?.type === 'node' ? selectedHeadValue.nodeId : null,
  )

  function flattenRows(
    roots: ReadonlyArray<MessageTreeNode>,
    runs: ReadonlyArray<ActiveRun>,
  ): ReadonlyArray<TreeRow> {
    const rows: TreeRow[] = []
    const runsByBase = new Map<string | null, ActiveRun[]>()

    for (const run of runs) {
      const siblings = runsByBase.get(run.baseNodeId) ?? []
      siblings.push(run)
      runsByBase.set(run.baseNodeId, siblings)
    }

    const visit = (
      node: MessageTreeNode,
      structuralDepth: number,
      branchGutters: TreeRowLayout['branchGutters'],
      branchConnector: BranchConnector,
    ) => {
      const visualDepth = structuralDepth

      if (isToolMessage(node.message)) {
        for (const child of node.children) {
          visit(child, structuralDepth, branchGutters, branchConnector)
        }
        for (const run of runsByBase.get(node.message.id) ?? []) {
          rows.push({
            type: 'run',
            id: runTreeNodeId(run.runId),
            structuralDepth,
            visualDepth,
            branchConnector: null,
            branchGutters,
            run,
          })
        }
        return
      }

      const toolExchange = summarizeAssistantToolExchange(node)
      const targetNodeId = toolExchange?.targetNodeId ?? node.message.id
      const coveredNodeIds = toolExchange?.coveredNodeIds ?? [node.message.id]
      const continuationChildren =
        toolExchange?.continuationChildren ?? node.children
      const toolCallCount = toolExchange?.toolCallCount ?? 0
      const toolCallNames = toolExchange?.toolCallNames ?? []
      const unresolvedToolCallCount =
        toolExchange === null
          ? 0
          : toolExchange.toolCallCount - toolExchange.resolvedToolResultCount
      const childCount =
        continuationChildren.length +
        (runsByBase.get(targetNodeId)?.length ?? 0)
      rows.push({
        type: 'node',
        id: node.message.id,
        structuralDepth,
        visualDepth,
        branchConnector,
        branchGutters,
        message: node.message,
        targetNodeId,
        coveredNodeIds,
        childCount,
        toolCallCount,
        toolCallNames,
        unresolvedToolCallCount,
        canSelect: unresolvedToolCallCount === 0,
      })

      const childStructuralDepth = structuralDepth + (childCount > 1 ? 1 : 0)
      const childGutters =
        childCount > 1 && structuralDepth >= 0
          ? [...branchGutters, { level: structuralDepth, continues: false }]
          : branchGutters
      const visibleChildren = continuationChildren.filter(
        (child) => !isToolMessage(child.message),
      )
      const hiddenToolChildren = continuationChildren.filter((child) =>
        isToolMessage(child.message),
      )
      const childEntries: ReadonlyArray<
        | { readonly type: 'node'; readonly node: MessageTreeNode }
        | { readonly type: 'run'; readonly run: ActiveRun }
      > = [
        ...visibleChildren.map((child) => ({
          type: 'node' as const,
          node: child,
        })),
        ...hiddenToolChildren.map((child) => ({
          type: 'node' as const,
          node: child,
        })),
        ...(runsByBase.get(targetNodeId) ?? []).map((run) => ({
          type: 'run' as const,
          run,
        })),
      ]

      childEntries.forEach((entry, index) => {
        const isLastChild = index === childEntries.length - 1
        const nextGutters =
          childCount > 1
            ? childGutters.map((gutter) =>
                gutter.level === structuralDepth
                  ? { ...gutter, continues: !isLastChild }
                  : gutter,
              )
            : childGutters
        const childConnector: BranchConnector =
          childCount > 1 ? (isLastChild ? 'last' : 'middle') : null

        if (entry.type === 'node') {
          visit(entry.node, childStructuralDepth, nextGutters, childConnector)
        } else {
          rows.push({
            type: 'run',
            id: runTreeNodeId(entry.run.runId),
            structuralDepth: childStructuralDepth,
            visualDepth: childStructuralDepth,
            branchConnector: childConnector,
            branchGutters: nextGutters,
            run: entry.run,
          })
        }
      })
    }

    for (const root of roots) visit(root, 0, [], null)
    for (const run of runsByBase.get(null) ?? []) {
      rows.push({
        type: 'run',
        id: runTreeNodeId(run.runId),
        structuralDepth: 0,
        visualDepth: 0,
        branchConnector: null,
        branchGutters: [],
        run,
      })
    }

    return rows
  }

  function gutterMarks(row: TreeRow): ReadonlyArray<GutterMark> {
    const marks: GutterMark[] = Array.from(
      { length: row.visualDepth },
      () => 'blank',
    )

    for (const gutter of row.branchGutters) {
      if (
        gutter.level >= 0 &&
        gutter.level < marks.length &&
        gutter.continues
      ) {
        marks[gutter.level] = 'vertical'
      }
    }

    if (row.branchConnector !== null && row.structuralDepth > 0) {
      marks[row.structuralDepth - 1] = row.branchConnector
    }

    return marks
  }

  function selectNode(nodeId: string) {
    selectedHead.setSelectedHead({ type: 'node', nodeId })
  }

  function selectRun(run: ActiveRun) {
    selectedHead.setSelectedHead({
      type: 'run',
      runId: run.runId,
      baseNodeId: run.baseNodeId,
    })
  }

  function selectedPath(
    messages: ReadonlyArray<MessageNode>,
    headNodeId: string | null,
  ): ReadonlyArray<MessageNode> {
    if (headNodeId === null) return []
    const byId = new Map(messages.map((message) => [message.id, message]))
    const path: MessageNode[] = []
    const seen = new Set<string>()
    let cursor: string | null = headNodeId
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor)
      const message = byId.get(cursor)
      if (!message) return []
      path.push(message)
      cursor = message.parentId
    }
    return path.reverse()
  }

  function resetCompactMode() {
    compactMode = false
    compactStartNodeId = null
    compactEndNodeId = null
    compactInstructions = ''
  }

  function toggleCompactMode() {
    if (compactMode) {
      resetCompactMode()
      return
    }
    compactMode = true
    compactStartNodeId = null
    compactEndNodeId = null
  }

  function compactIndex(nodeId: string | null) {
    if (nodeId === null) return -1
    return selectedPathRows.findIndex((message) => message.id === nodeId)
  }

  function isInCompactRange(nodeId: string) {
    const start = compactIndex(compactStartNodeId)
    const end = compactIndex(compactEndNodeId)
    const index = compactIndex(nodeId)
    if (start < 0 || end < 0 || index < 0) return false
    return index >= Math.min(start, end) && index <= Math.max(start, end)
  }

  function selectCompactEndpoint(nodeId: string) {
    if (compactStartNodeId === null || compactEndNodeId !== null) {
      compactStartNodeId = nodeId
      compactEndNodeId = null
      return
    }
    compactEndNodeId = nodeId
  }

  async function startCompaction() {
    if (!model || baseHeadNodeId === null || compactStartNodeId === null) return
    const endNodeId = compactEndNodeId ?? compactStartNodeId
    const start = compactIndex(compactStartNodeId)
    const end = compactIndex(endNodeId)
    if (start < 0 || end < 0) return
    const startNodeId = selectedPathRows[Math.min(start, end)]?.id
    const orderedEndNodeId = selectedPathRows[Math.max(start, end)]?.id
    if (!startNodeId || !orderedEndNodeId) return

    const response = await Effect.runPromise(
      sessionStore.compactRange(
        sessionId,
        model,
        baseHeadNodeId,
        startNodeId,
        orderedEndNodeId,
        compactInstructions.trim() || undefined,
      ),
    )
    if (!response) return
    selectedHead.setSelectedHead({
      type: 'run',
      runId: response.runId,
      baseNodeId: response.baseNodeId,
    })
    compactMode = false
  }

  function isSelectedTreeRow(
    head: SelectedHead,
    row: Extract<TreeRow, { type: 'node' }>,
  ) {
    return head?.type === 'node' && row.coveredNodeIds.includes(head.nodeId)
  }

  function isSelectedRun(head: SelectedHead, runId: string) {
    return head?.type === 'run' && head.runId === runId
  }

  function rowPreview(row: Extract<TreeRow, { type: 'node' }>) {
    if (row.toolCallCount === 0) return messagePreview(row.message)
    return messageNarrativePreview(row.message)
  }

  function toolBadgeNames(row: Extract<TreeRow, { type: 'node' }>) {
    return row.toolCallNames
  }

  type TreeTone = 'user' | 'assistant' | 'tool' | 'system' | 'summary'

  function messageTone(message: MessageNode): TreeTone {
    if (message.kind === 'summary') return 'summary'
    return message.encoded.role
  }

  function nodeIcon(row: Extract<TreeRow, { type: 'node' }>) {
    const message = row.message
    if (message.kind === 'summary') return FileTextIcon
    switch (message.encoded.role) {
      case 'user':
        return UserIcon
      case 'assistant':
        return RobotIcon
      case 'tool':
        return WrenchIcon
      case 'system':
        return ChatCircleTextIcon
    }
  }
</script>

<aside
  class="flex h-full w-full shrink-0 flex-col border-l border-border bg-background"
>
  <Tabs.Root bind:value={activeTab} class="min-h-0 flex-1 gap-0">
    <div
      class="flex h-[var(--session-header-height)] items-center border-b border-border px-3"
    >
      <Tabs.List class="w-full" variant="default">
        <Tabs.Trigger value="tree">
          <GitBranchIcon />
          Tree
        </Tabs.Trigger>
        <Tabs.Trigger value="diff">Diff</Tabs.Trigger>
      </Tabs.List>
    </div>

    <Tabs.Content value="tree" class="min-h-0 overflow-auto">
      {#if messagesStore.loadingForTab(tabId)}
        <LoadingState />
      {:else if rows.length === 0}
        <div class="p-3 text-sm text-muted-foreground">No messages yet.</div>
      {:else if compactMode}
        <div class="space-y-2 p-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium text-foreground">
                Compact context
              </div>
              <div class="text-xs text-muted-foreground">
                Select a range on the active path.
              </div>
            </div>
            <Button variant="ghost" size="sm" onclick={resetCompactMode}
              >Cancel</Button
            >
          </div>
          <div
            class="rounded border border-border bg-base p-2 text-xs text-muted-foreground"
          >
            Sorato will generate and install the summary without rewriting
            existing history.
          </div>
          <div class="flex flex-col">
            {#each selectedPathRows as message (message.id)}
              {@const selected =
                message.id === compactStartNodeId ||
                message.id === compactEndNodeId}
              {@const inRange = isInCompactRange(message.id)}
              <Button
                variant="ghost"
                size="sm"
                class="h-auto justify-start gap-1.5 px-1.5 py-0.5 text-left hover:bg-base-hover {inRange
                  ? 'bg-selected hover:bg-selected'
                  : ''}"
                onclick={() => selectCompactEndpoint(message.id)}
              >
                <span
                  class="tree-icon flex size-5 shrink-0 items-center justify-center"
                  data-tone={messageTone(message)}
                  data-selected={selected}
                >
                  {#if message.kind === 'summary'}
                    <FileTextIcon class="size-3.5" />
                  {:else if message.encoded.role === 'user'}
                    <UserIcon class="size-3.5" />
                  {:else if message.encoded.role === 'assistant'}
                    <RobotIcon class="size-3.5" />
                  {:else if message.encoded.role === 'tool'}
                    <WrenchIcon class="size-3.5" />
                  {:else}
                    <ChatCircleTextIcon class="size-3.5" />
                  {/if}
                </span>
                <span
                  class="tree-preview min-w-0 flex-1 truncate text-sm font-normal text-foreground"
                  data-tone={messageTone(message)}
                >
                  {messagePreview(message)}
                </span>
              </Button>
            {/each}
          </div>
          <textarea
            class="min-h-20 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            bind:value={compactInstructions}
            placeholder="Optional summarizer instructions"></textarea>
          <Button
            class="w-full"
            size="sm"
            disabled={!model ||
              baseHeadNodeId === null ||
              compactStartNodeId === null}
            onclick={startCompaction}
          >
            Generate summary
          </Button>
        </div>
      {:else}
        <div class="border-b border-border p-2">
          <Button
            variant="outline"
            size="sm"
            class="w-full gap-1.5"
            disabled={!model || baseHeadNodeId === null}
            onclick={toggleCompactMode}
          >
            <FileTextIcon class="size-3.5" />
            Compact
          </Button>
        </div>
        <div class="flex flex-col p-1.5">
          {#each rows as row (row.id)}
            {#if row.type === 'node'}
              {@const selected = isSelectedTreeRow(selectedHeadValue, row)}
              {@const rowInPath = row.coveredNodeIds.some((id) =>
                selectedPathIds.has(id),
              )}
              {@const Icon = nodeIcon(row)}
              {@const preview = rowPreview(row)}
              {@const tone = messageTone(row.message)}
              <Button
                variant="ghost"
                size="sm"
                class="h-auto justify-start gap-0.5 px-1.5 py-0.5 text-left hover:bg-base-hover disabled:opacity-70 {selected
                  ? 'bg-selected text-foreground hover:bg-selected'
                  : ''}"
                title={row.canSelect
                  ? row.targetNodeId
                  : 'Tool exchange incomplete'}
                disabled={!row.canSelect}
                onclick={() => selectNode(row.targetNodeId)}
              >
                <span class="flex shrink-0 self-stretch">
                  {#each gutterMarks(row) as mark}
                    <span class="tree-gutter" data-mark={mark}></span>
                  {/each}
                </span>
                <span
                  class="tree-icon flex size-5 shrink-0 items-center justify-center"
                  data-tone={tone}
                  data-in-path={rowInPath}
                >
                  <Icon class="size-3.5" />
                </span>
                <span class="flex min-w-0 flex-1 items-center gap-1.5">
                  {#if preview.length > 0}
                    <span
                      class="tree-preview truncate text-sm font-normal text-foreground"
                      data-tone={tone}
                    >
                      {preview}
                    </span>
                  {/if}
                  {#if row.toolCallCount > 0}
                    {#each toolBadgeNames(row) as toolName}
                      <span
                        class="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                      >
                        <WrenchIcon class="size-3" />
                        {toolName}
                      </span>
                    {/each}
                    {#if row.unresolvedToolCallCount > 0}
                      <span
                        class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                      >
                        {row.unresolvedToolCallCount} pending
                      </span>
                    {/if}
                  {/if}
                </span>
              </Button>
            {:else}
              {@const selected = isSelectedRun(
                selectedHeadValue,
                row.run.runId,
              )}
              <Button
                variant="ghost"
                size="sm"
                class="h-auto justify-start gap-0.5 px-1.5 py-0.5 text-left hover:bg-base-hover {selected
                  ? 'bg-selected text-foreground hover:bg-selected'
                  : ''}"
                title={row.run.runId}
                onclick={() => selectRun(row.run)}
              >
                <span class="flex shrink-0 self-stretch">
                  {#each gutterMarks(row) as mark}
                    <span class="tree-gutter" data-mark={mark}></span>
                  {/each}
                </span>
                <span
                  class="tree-icon flex size-5 shrink-0 items-center justify-center"
                  data-tone={row.run.kind === 'summary'
                    ? 'summary'
                    : 'assistant'}
                  data-in-path="true"
                >
                  <CircleNotchIcon class="size-3.5 animate-spin" />
                </span>
                <span
                  class="tree-preview min-w-0 flex-1 truncate text-sm font-normal text-foreground"
                  data-tone={row.run.kind === 'summary'
                    ? 'summary'
                    : 'assistant'}
                >
                  {row.run.kind === 'summary'
                    ? 'Summarizing'
                    : 'Streaming branch'}
                </span>
              </Button>
            {/if}
          {/each}
        </div>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="diff" class="min-h-0 overflow-auto">
      <div class="flex h-full items-center justify-center p-6 text-center">
        <div class="max-w-xs space-y-1">
          <h3 class="text-sm font-medium text-foreground">
            Diff panel coming soon
          </h3>
          <p class="text-sm text-muted-foreground">
            Code changes for this session will appear here.
          </p>
        </div>
      </div>
    </Tabs.Content>
  </Tabs.Root>
</aside>

<style>
  .tree-icon,
  .tree-preview {
    --tree-tone: var(--foreground);
  }

  .tree-icon {
    color: color-mix(in oklch, var(--tree-tone) 88%, var(--foreground));
  }

  .tree-icon[data-in-path='true'],
  .tree-icon[data-selected='true'] {
    color: var(--tree-tone);
  }

  .tree-icon[data-tone='user'],
  .tree-preview[data-tone='user'] {
    --tree-tone: var(--tree-user);
  }

  .tree-icon[data-tone='assistant'],
  .tree-preview[data-tone='assistant'] {
    --tree-tone: var(--tree-assistant);
  }

  .tree-icon[data-tone='summary'],
  .tree-preview[data-tone='summary'] {
    --tree-tone: var(--tree-summary);
  }

  .tree-icon[data-tone='tool'],
  .tree-preview[data-tone='tool'] {
    --tree-tone: var(--tree-tool);
  }

  .tree-icon[data-tone='system'],
  .tree-preview[data-tone='system'] {
    --tree-tone: var(--tree-system);
  }

  .tree-gutter {
    --tree-branch-line: var(--muted-foreground);
    --tree-branch-line-width: 2px;
    position: relative;
    display: inline-flex;
    width: 1.375rem;
    min-height: 1.25rem;
    flex-shrink: 0;
  }

  .tree-gutter[data-mark='vertical']::before,
  .tree-gutter[data-mark='middle']::before,
  .tree-gutter[data-mark='last']::before {
    position: absolute;
    left: calc(0.75rem - (var(--tree-branch-line-width) / 2));
    width: var(--tree-branch-line-width);
    border-radius: 9999px;
    content: '';
  }

  .tree-gutter[data-mark='vertical']::before,
  .tree-gutter[data-mark='middle']::before {
    top: -0.375rem;
    bottom: -0.375rem;
    background: var(--tree-branch-line);
  }

  .tree-gutter[data-mark='last']::before {
    top: -0.375rem;
    bottom: 50%;
    background: var(--tree-branch-line);
  }

  .tree-gutter[data-mark='middle']::after,
  .tree-gutter[data-mark='last']::after {
    position: absolute;
    top: calc(50% - (var(--tree-branch-line-width) / 2));
    left: 0.75rem;
    right: -0.125rem;
    height: var(--tree-branch-line-width);
    border-radius: 9999px;
    background: var(--tree-branch-line);
    content: '';
  }
</style>
