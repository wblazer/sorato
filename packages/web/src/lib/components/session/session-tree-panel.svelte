<script lang="ts">
  import { onDestroy } from 'svelte'
  import LoadingState from '$lib/components/loading-state.svelte'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { runConnectionPromise } from '$lib/connection-runtime.js'
  import type { MessageNode } from '$lib/types.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Checkbox } from '$lib/components/ui/checkbox/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import StreamingDots from '$lib/components/ui/streaming-dots.svelte'
  import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon'
  import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon'
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon'
  import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon'
  import { messageNarrativePreview, messagePreview } from './session-tree.js'
  import {
    buildSessionTreeModel,
    compactRangeForHead,
    headForSessionTreeItem,
    itemIdForHead,
    pathItemIdsForHead,
    type SessionTreeActiveRun,
    type SessionTreeItem,
    type ToolCallSummary,
  } from './session-tree-model.js'
  import type { SessionSelectedHeadController } from './session-selected-head.svelte.js'
  import { iconForMessageName, roleIcons } from './message-icons.js'

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
  let compactDragCleanup: (() => void) | null = null
  let compactDragFixedNodeId = $state<string | null>(null)
  const groupAgentStepsStorageKey = 'sorato.sessionTree.groupAgentSteps'
  let groupAgentSteps = $state(readGroupAgentStepsSetting())

  onDestroy(() => {
    compactDragCleanup?.()
  })

  type ActiveRun = ReturnType<typeof sessionStore.activeRunsFor>[number]
  type BranchConnector = 'first' | 'middle' | 'last' | null
  type GutterMark = 'blank' | 'vertical' | 'first' | 'middle' | 'last'

  interface BranchGutter {
    readonly level: number
    readonly continues: boolean
    readonly active: boolean
  }

  interface TreeRowLayout {
    readonly structuralDepth: number
    readonly visualDepth: number
    readonly branchConnector: BranchConnector
    readonly branchGutters: ReadonlyArray<BranchGutter>
    readonly parentConnector: boolean
    readonly childConnector: boolean
    readonly activeParentConnector: boolean
    readonly activeChildConnector: boolean
    readonly activeBranchVertical: boolean
    readonly activeBranchHorizontal: boolean
  }

  type TreeRow =
    | ({
        readonly type: 'node'
        readonly id: string
        readonly message: MessageNode
        readonly targetNodeId: string
        readonly coveredNodeIds: ReadonlyArray<string>
        readonly startNodeId: string
        readonly displayMessage: MessageNode
        readonly combinedRun: boolean
        readonly childCount: number
        readonly toolCallCount: number
        readonly toolCalls: ReadonlyArray<ToolCallSummary>
        readonly unresolvedToolCallCount: number
      } & TreeRowLayout)
    | ({
        readonly type: 'run'
        readonly id: string
        readonly run: ActiveRun
        readonly attachment: SessionTreeActiveRun['attachment']
      } & TreeRowLayout)

  const messages = $derived(messagesStore.messagesForTab(tabId))
  const activeRuns = $derived(sessionStore.activeRunsFor(sessionId))
  const selectedHeadValue = $derived(selectedHead.renderHead)
  const treeModel = $derived.by(() =>
    buildSessionTreeModel({ messages, activeRuns, groupAgentSteps }),
  )
  const selectedItemId = $derived.by(() =>
    itemIdForHead(treeModel, selectedHeadValue),
  )
  const selectedPathItemIds = $derived.by(() =>
    pathItemIdsForHead(treeModel, selectedHeadValue),
  )
  const rows = $derived.by(() =>
    flattenRows(treeModel.roots, selectedPathItemIds),
  )
  const compactRows = $derived.by(() =>
    rows.filter(
      (row): row is Extract<TreeRow, { type: 'node' }> =>
        row.type === 'node' &&
        canCompactMessage(row.message) &&
        selectedPathItemIds.has(row.id),
    ),
  )
  const baseHeadNodeId = $derived.by(() =>
    selectedHeadValue?.type === 'node' ? selectedHeadValue.nodeId : null,
  )

  function flattenRows(
    roots: ReadonlyArray<SessionTreeItem>,
    selectedPathItemIds: ReadonlySet<string>,
  ): ReadonlyArray<TreeRow> {
    const rows: TreeRow[] = []
    const visit = (
      item: SessionTreeItem,
      structuralDepth: number,
      branchGutters: ReadonlyArray<BranchGutter>,
      branchConnector: BranchConnector,
      parentConnector: boolean,
      activeParentConnector: boolean,
      activeBranchVertical: boolean,
      activeBranchHorizontal: boolean,
    ) => {
      const visualDepth = structuralDepth
      const childCount = item.children.length
      const itemInPath = selectedPathItemIds.has(item.id)
      if (item.type === 'node-group') {
        rows.push({
          type: 'node',
          id: item.id,
          structuralDepth,
          visualDepth,
          branchConnector,
          branchGutters,
          parentConnector,
          childConnector: childCount > 0,
          activeParentConnector,
          activeChildConnector: false,
          activeBranchVertical,
          activeBranchHorizontal,
          message: item.message,
          startNodeId: item.compactRange.startNodeId,
          displayMessage: item.displayMessage,
          combinedRun: item.combinedRun,
          targetNodeId: item.compactRange.endNodeId,
          coveredNodeIds: item.nodeIds,
          childCount,
          toolCallCount: item.toolCallCount,
          toolCalls: item.toolCalls,
          unresolvedToolCallCount: item.unresolvedToolCallCount,
        })
      } else {
        rows.push({
          type: 'run',
          id: item.id,
          structuralDepth,
          visualDepth,
          branchConnector,
          branchGutters,
          parentConnector,
          childConnector: childCount > 0,
          activeParentConnector,
          activeChildConnector: false,
          activeBranchVertical,
          activeBranchHorizontal,
          run: item.run,
          attachment: item.attachment,
        })
      }

      const childStructuralDepth = structuralDepth + (childCount > 1 ? 1 : 0)
      const branchGuttersForChildren =
        branchConnector !== null && activeBranchHorizontal
          ? branchGutters.map((gutter) =>
              gutter.level === structuralDepth - 1
                ? { ...gutter, active: false }
                : gutter,
            )
          : branchGutters
      const childGutters =
        childCount > 1 && structuralDepth >= 0
          ? [
              ...branchGuttersForChildren,
              { level: structuralDepth, continues: false, active: false },
            ]
          : branchGuttersForChildren
      const orderedChildren = [...item.children].sort(
        (a, b) => Number(itemInSelectedPath(b)) - Number(itemInSelectedPath(a)),
      )
      const selectedChildIndex = orderedChildren.findIndex(itemInSelectedPath)

      if (itemInPath && selectedChildIndex >= 0) {
        const row = rows[rows.length - 1]
        rows[rows.length - 1] = { ...row, activeChildConnector: true }
      }

      orderedChildren.forEach((child, index) => {
        const isLastChild = index === orderedChildren.length - 1
        const activeBranchLevel =
          selectedChildIndex >= 0 && index <= selectedChildIndex
        const nextGutters =
          childCount > 1
            ? childGutters.map((gutter) =>
                gutter.level === structuralDepth
                  ? {
                      ...gutter,
                      continues: !isLastChild,
                      active: activeBranchLevel,
                    }
                  : gutter,
              )
            : childGutters
        const childConnector: BranchConnector =
          childCount > 1
            ? isLastChild
              ? 'last'
              : index === 0
                ? 'first'
                : 'middle'
            : null

        const childInPath = itemInSelectedPath(child)
        visit(
          child,
          childStructuralDepth,
          nextGutters,
          childConnector,
          childConnector === null,
          childConnector === null && itemInPath && childInPath,
          selectedChildIndex >= 0 && index <= selectedChildIndex,
          childInPath,
        )
      })
    }

    const orderedRoots = [...roots].sort(
      (a, b) => Number(itemInSelectedPath(b)) - Number(itemInSelectedPath(a)),
    )
    for (const root of orderedRoots)
      visit(root, 0, [], null, false, false, false, false)

    return rows

    function itemInSelectedPath(item: SessionTreeItem) {
      return selectedPathItemIds.has(item.id)
    }
  }

  function readGroupAgentStepsSetting() {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(groupAgentStepsStorageKey) !== 'false'
  }

  function writeGroupAgentStepsSetting(value: boolean) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(groupAgentStepsStorageKey, String(value))
  }

  function setGroupAgentSteps(value: boolean) {
    if (value === groupAgentSteps) return
    clearCompactDrag()
    clearCompactSelection()
    groupAgentSteps = value
    writeGroupAgentStepsSetting(value)
  }

  function gutterMarks(row: TreeRow): ReadonlyArray<{
    readonly mark: GutterMark
    readonly activeVerticalTop: boolean
    readonly activeVerticalBottom: boolean
    readonly activeHorizontal: boolean
  }> {
    const marks = Array.from({ length: row.visualDepth }, () => ({
      mark: 'blank' as GutterMark,
      activeVerticalTop: false,
      activeVerticalBottom: false,
      activeHorizontal: false,
    }))

    for (const gutter of row.branchGutters) {
      if (
        gutter.level >= 0 &&
        gutter.level < marks.length &&
        gutter.continues
      ) {
        marks[gutter.level] = {
          mark: 'vertical',
          activeVerticalTop: gutter.active,
          activeVerticalBottom: gutter.active,
          activeHorizontal: false,
        }
      }
    }

    if (row.branchConnector !== null && row.structuralDepth > 0) {
      const connectorGutter = row.branchGutters.find(
        (gutter) => gutter.level === row.structuralDepth - 1,
      )
      const activeVertical = connectorGutter?.active ?? row.activeBranchVertical
      marks[row.structuralDepth - 1] = {
        mark: row.branchConnector,
        activeVerticalTop: activeVertical,
        activeVerticalBottom:
          activeVertical &&
          (!row.activeBranchHorizontal || row.branchConnector === 'last'),
        activeHorizontal: row.activeBranchHorizontal,
      }
    }

    return marks
  }

  function selectTreeItem(itemId: string) {
    const item = treeModel.itemById.get(itemId)
    if (item) selectedHead.setSelectedHead(headForSessionTreeItem(item))
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
    return compactRows.findIndex((row) => row.id === nodeId)
  }

  function isInCompactRange(nodeId: string) {
    const start = compactIndex(compactStartNodeId)
    const end = compactIndex(compactEndNodeId)
    const index = compactIndex(nodeId)
    if (start < 0 || end < 0 || index < 0) return false
    return index >= Math.min(start, end) && index <= Math.max(start, end)
  }

  function isCompactSelected(nodeId: string) {
    return nodeId === compactStartNodeId || nodeId === compactEndNodeId
  }

  function hasCompactRange() {
    return compactStartNodeId !== null && compactEndNodeId !== null
  }

  function clearCompactDrag() {
    compactDragCleanup?.()
    compactDragCleanup = null
    compactDragFixedNodeId = null
  }

  function clearCompactSelection() {
    compactStartNodeId = null
    compactEndNodeId = null
  }

  function selectCompactRow(nodeId: string) {
    if (compactStartNodeId === null) {
      compactStartNodeId = nodeId
      compactEndNodeId = null
      return
    }

    if (compactEndNodeId === null) {
      if (compactStartNodeId === nodeId) clearCompactSelection()
      else compactEndNodeId = nodeId
      return
    }

    const currentIndex = compactIndex(nodeId)
    const startIndex = compactIndex(compactStartNodeId)
    const endIndex = compactIndex(compactEndNodeId)
    if (currentIndex >= 0 && startIndex >= 0 && endIndex >= 0) {
      const min = Math.min(startIndex, endIndex)
      const max = Math.max(startIndex, endIndex)
      if (currentIndex < min) {
        if (startIndex === min) compactStartNodeId = nodeId
        else compactEndNodeId = nodeId
        return
      }
      if (currentIndex > max) {
        if (startIndex === max) compactStartNodeId = nodeId
        else compactEndNodeId = nodeId
        return
      }
    }

    compactStartNodeId = nodeId
    compactEndNodeId = null
  }

  function compactFixedEdgeForDrag(nodeId: string) {
    if (compactStartNodeId === null || compactEndNodeId === null) return

    const currentIndex = compactIndex(nodeId)
    const startIndex = compactIndex(compactStartNodeId)
    const endIndex = compactIndex(compactEndNodeId)
    if (currentIndex < 0 || startIndex < 0 || endIndex < 0) return

    const min = Math.min(startIndex, endIndex)
    const max = Math.max(startIndex, endIndex)
    if (currentIndex === startIndex) return compactEndNodeId
    if (currentIndex === endIndex) return compactStartNodeId
    if (currentIndex < min) {
      return startIndex === max ? compactStartNodeId : compactEndNodeId
    }
    if (currentIndex > max) {
      return startIndex === min ? compactStartNodeId : compactEndNodeId
    }

    return
  }

  function startNewCompactRange(nodeId: string) {
    compactStartNodeId = nodeId
    compactEndNodeId = null
  }

  function startCompactDrag(nodeId: string, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    clearCompactDrag()

    if (compactStartNodeId === nodeId && compactEndNodeId === null) {
      clearCompactSelection()
      return
    }

    const fixedEdge = compactFixedEdgeForDrag(nodeId)
    if (fixedEdge !== undefined) {
      compactStartNodeId = fixedEdge
      compactEndNodeId = nodeId
      compactDragFixedNodeId = fixedEdge
    } else if (compactEndNodeId !== null) {
      startNewCompactRange(nodeId)
    } else if (compactStartNodeId === null) {
      startNewCompactRange(nodeId)
    } else {
      compactEndNodeId = nodeId
      compactDragFixedNodeId = compactStartNodeId
    }

    const handlePointerUp = () => {
      clearCompactDrag()
    }
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
    compactDragCleanup = () => {
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }

  function updateCompactDrag(nodeId: string) {
    if (compactDragCleanup === null || compactStartNodeId === null) return
    if (compactDragFixedNodeId !== null) {
      compactStartNodeId = compactDragFixedNodeId
      compactEndNodeId = compactDragFixedNodeId === nodeId ? null : nodeId
      return
    }
    compactEndNodeId = compactStartNodeId === nodeId ? null : nodeId
  }

  function handleCompactKeydown(nodeId: string, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectCompactRow(nodeId)
  }

  async function startCompaction() {
    if (!model || baseHeadNodeId === null || compactStartNodeId === null) return
    const endNodeId = compactEndNodeId ?? compactStartNodeId
    const start = compactIndex(compactStartNodeId)
    const end = compactIndex(endNodeId)
    if (start < 0 || end < 0) return
    const startRow = compactRows[Math.min(start, end)]
    const endRow = compactRows[Math.max(start, end)]
    const startNodeId = startRow?.startNodeId
    const orderedEndNodeId = endRow
      ? compactRangeForHead(treeModel, endRow.id, selectedHeadValue)?.endNodeId
      : undefined
    if (!startNodeId || !orderedEndNodeId) return

    const response = await runConnectionPromise(
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

  function canCompactMessage(message: MessageNode) {
    return (
      message.kind !== 'message' ||
      message.encoded.role !== 'system' ||
      (message.encoded.source !== 'system-prompt' &&
        message.encoded.source !== 'agents-md')
    )
  }

  function rowPreview(row: Extract<TreeRow, { type: 'node' }>) {
    if (row.combinedRun) return messageNarrativePreview(row.displayMessage)
    if (row.toolCallCount === 0) return messagePreview(row.message)
    return messageNarrativePreview(row.message)
  }

  function toolBadges(row: Extract<TreeRow, { type: 'node' }>) {
    return row.toolCalls
  }

  function toolCountLabel(count: number) {
    return count === 1 ? '1 tool' : `${count} tools`
  }

  type TreeTone = 'user' | 'assistant' | 'tool' | 'system' | 'summary'

  function messageTone(message: MessageNode): TreeTone {
    const summaryTone = 'summary'
    if (message.kind === 'summary') return summaryTone
    return message.encoded.role
  }

  function nodeIcon(row: Extract<TreeRow, { type: 'node' }>) {
    const message = row.message
    if (message.kind === 'summary') return roleIcons.summary
    switch (message.encoded.role) {
      case 'user':
        return roleIcons.user
      case 'assistant':
        return roleIcons.assistant
      case 'tool':
        return roleIcons.tool
      case 'system':
        return roleIcons.system
    }
  }

  function toolBadgeIcon(tool: ToolCallSummary) {
    return iconForMessageName(tool.icon) ?? roleIcons.tool
  }

  function runIcon(run: ActiveRun) {
    return run.kind === 'summary' ? roleIcons.summary : roleIcons.assistant
  }

  function runTone(run: ActiveRun): TreeTone {
    return run.kind === 'summary' ? 'summary' : 'assistant'
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

    <Tabs.Content value="tree" class="flex min-h-0 flex-col overflow-hidden">
      {#if messagesStore.loadingForTab(tabId)}
        <LoadingState />
      {:else if rows.length === 0}
        <div class="p-3 text-sm text-muted-foreground">No messages yet.</div>
      {:else if compactMode}
        <div
          class="shrink-0 space-y-2 border-b border-border bg-background p-2"
        >
          <div class="relative flex h-7 items-center justify-center">
            <Button
              variant="ghost"
              size="icon-sm"
              class="absolute left-0"
              aria-label="Back"
              onclick={resetCompactMode}
            >
              <ArrowLeftIcon />
            </Button>
            <div class="text-center text-sm font-medium text-foreground">
              Select a range to compact
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={groupAgentSteps}
              onCheckedChange={setGroupAgentSteps}
            />
            <span>Group agent steps</span>
          </label>
        </div>
        <ScrollArea class="min-h-0 flex-1" orientation="vertical">
          <div class="flex flex-col p-1.5">
            {#each compactRows as row, index (row.id)}
              {@const selected = isCompactSelected(row.id)}
              {@const inRange = isInCompactRange(row.id)}
              {@const hasPrevious = index > 0}
              {@const hasNext = index < compactRows.length - 1}
              {@const Icon = nodeIcon(row)}
              {@const preview = rowPreview(row)}
              {@const tone = messageTone(row.message)}
              <Button
                variant="ghost"
                size="sm"
                class="h-auto justify-start gap-0.5 px-1.5 py-0.5 text-left hover:bg-base-hover {selected
                  ? 'bg-selected text-foreground hover:bg-selected'
                  : inRange
                    ? 'bg-selected/45 hover:bg-selected/60'
                    : ''}"
                onpointerdown={(event) => startCompactDrag(row.id, event)}
                onpointerenter={() => updateCompactDrag(row.id)}
                onkeydown={(event) => handleCompactKeydown(row.id, event)}
              >
                <span
                  class="tree-icon flex size-5 shrink-0 items-center justify-center"
                  data-tone={tone}
                  data-in-path="true"
                  data-selected={selected}
                  data-parent-connector={hasPrevious}
                  data-child-connector={hasNext}
                  data-active-parent-connector={hasPrevious}
                  data-active-child-connector={hasNext}
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
                  {#if row.toolCallCount > 0 && !row.combinedRun}
                    {#each toolBadges(row) as tool}
                      {@const ToolIcon = toolBadgeIcon(tool)}
                      <span
                        class="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                      >
                        <ToolIcon class="size-3" />
                        {tool.name}
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
                  {#if row.combinedRun && row.toolCallCount > 0}
                    <span
                      class="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                    >
                      <WrenchIcon class="size-3" />
                      {toolCountLabel(row.toolCallCount)}
                    </span>
                  {/if}
                </span>
              </Button>
            {/each}
          </div>
        </ScrollArea>
        <div class="flex shrink-0 flex-col gap-2 border-t border-border p-2">
          <Button
            variant="outline"
            size="sm"
            class="w-full"
            disabled={compactStartNodeId === null}
            onclick={clearCompactSelection}
          >
            Clear selection
          </Button>
          <textarea
            class="min-h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            bind:value={compactInstructions}
            placeholder="Optional summarizer instructions"></textarea>
          <Button
            class="w-full"
            disabled={!model ||
              baseHeadNodeId === null ||
              compactStartNodeId === null}
            onclick={startCompaction}
          >
            Generate summary
          </Button>
        </div>
      {:else}
        <div
          class="shrink-0 space-y-2 border-b border-border bg-background p-2"
        >
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
          <label class="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={groupAgentSteps}
              onCheckedChange={setGroupAgentSteps}
            />
            <span>Group agent steps</span>
          </label>
        </div>
        <ScrollArea class="min-h-0 flex-1" orientation="vertical">
          <div class="flex flex-col p-1.5">
            {#each rows as row (row.id)}
              {#if row.type === 'node'}
                {@const selected = selectedItemId === row.id}
                {@const rowInPath = selectedPathItemIds.has(row.id)}
                {@const Icon = nodeIcon(row)}
                {@const preview = rowPreview(row)}
                {@const tone = messageTone(row.message)}
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-auto justify-start gap-0.5 px-1.5 py-0.5 text-left hover:bg-base-hover disabled:opacity-70 {selected
                    ? 'bg-selected text-foreground hover:bg-selected'
                    : ''}"
                  title={row.targetNodeId}
                  onclick={() => selectTreeItem(row.id)}
                >
                  <span class="flex shrink-0 self-stretch">
                    {#each gutterMarks(row) as gutter}
                      <span
                        class="tree-gutter"
                        data-mark={gutter.mark}
                        data-active-vertical-top={gutter.activeVerticalTop}
                        data-active-vertical-bottom={gutter.activeVerticalBottom}
                        data-active-horizontal={gutter.activeHorizontal}
                      ></span>
                    {/each}
                  </span>
                  <span
                    class="tree-icon flex size-5 shrink-0 items-center justify-center"
                    data-tone={tone}
                    data-in-path={rowInPath}
                    data-parent-connector={row.parentConnector}
                    data-child-connector={row.childConnector}
                    data-active-parent-connector={row.activeParentConnector}
                    data-active-child-connector={row.activeChildConnector}
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
                    {#if row.toolCallCount > 0 && !row.combinedRun}
                      {#each toolBadges(row) as tool}
                        {@const ToolIcon = toolBadgeIcon(tool)}
                        <span
                          class="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                        >
                          <ToolIcon class="size-3" />
                          {tool.name}
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
                    {#if row.combinedRun && row.toolCallCount > 0}
                      <span
                        class="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                      >
                        <WrenchIcon class="size-3" />
                        {toolCountLabel(row.toolCallCount)}
                      </span>
                    {/if}
                  </span>
                </Button>
              {:else}
                {@const selected = selectedItemId === row.id}
                {@const RunIcon = runIcon(row.run)}
                {@const tone = runTone(row.run)}
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-auto justify-start gap-0.5 px-1.5 py-0.5 text-left hover:bg-base-hover {selected
                    ? 'bg-selected text-foreground hover:bg-selected'
                    : ''}"
                  title={row.attachment.type === 'unresolved'
                    ? `Run anchor ${row.attachment.nodeId} is unavailable`
                    : row.run.runId}
                  onclick={() => selectTreeItem(row.id)}
                >
                  <span class="flex shrink-0 self-stretch">
                    {#each gutterMarks(row) as gutter}
                      <span
                        class="tree-gutter"
                        data-mark={gutter.mark}
                        data-active-vertical-top={gutter.activeVerticalTop}
                        data-active-vertical-bottom={gutter.activeVerticalBottom}
                        data-active-horizontal={gutter.activeHorizontal}
                      ></span>
                    {/each}
                  </span>
                  <span
                    class="tree-icon flex size-5 shrink-0 items-center justify-center"
                    data-tone={tone}
                    data-in-path={selectedPathItemIds.has(row.id)}
                    data-parent-connector={row.parentConnector}
                    data-child-connector={row.childConnector}
                    data-active-parent-connector={row.activeParentConnector}
                    data-active-child-connector={row.activeChildConnector}
                  >
                    <RunIcon class="size-3.5" />
                  </span>
                  <span
                    class="flex min-w-0 flex-1 items-center pl-1 text-muted-foreground/60"
                  >
                    <StreamingDots
                      label={row.attachment.type === 'unresolved'
                        ? 'Run anchor unavailable'
                        : row.run.kind === 'summary'
                          ? 'Summarizing range'
                          : 'Streaming branch'}
                    />
                  </span>
                </Button>
              {/if}
            {/each}
          </div>
        </ScrollArea>
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
    --tree-branch-line: var(--muted-foreground);
    --tree-path-line: var(--tree-active-branch);
    --tree-branch-line-width: 2px;
    --tree-icon-connector-overlap: 0.125rem;
    position: relative;
    color: color-mix(in oklch, var(--tree-tone) 88%, var(--foreground));
  }

  .tree-icon[data-parent-connector='true']::before,
  .tree-icon[data-child-connector='true']::after {
    position: absolute;
    left: calc(50% - (var(--tree-branch-line-width) / 2));
    z-index: 0;
    width: var(--tree-branch-line-width);
    border-radius: 9999px;
    background: var(--tree-branch-line);
    content: '';
  }

  .tree-icon[data-active-parent-connector='true']::before,
  .tree-icon[data-active-child-connector='true']::after {
    background: var(--tree-path-line);
  }

  .tree-icon[data-parent-connector='true']::before {
    top: -0.375rem;
    bottom: calc(100% - var(--tree-icon-connector-overlap));
  }

  .tree-icon[data-child-connector='true']::after {
    top: calc(100% - var(--tree-icon-connector-overlap));
    bottom: -0.375rem;
  }

  .tree-icon :global(svg) {
    position: relative;
    z-index: 1;
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
    --tree-path-line: var(--tree-active-branch);
    --tree-branch-line-width: 2px;
    position: relative;
    display: inline-flex;
    width: 1.375rem;
    min-height: 1.25rem;
    flex-shrink: 0;
  }

  .tree-gutter[data-mark='vertical']::before,
  .tree-gutter[data-mark='first']::before,
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

  .tree-gutter[data-mark='first']::before {
    top: -0.375rem;
    bottom: -0.375rem;
    background: var(--tree-branch-line);
  }

  .tree-gutter[data-mark='last']::before {
    top: -0.375rem;
    bottom: 50%;
    background: var(--tree-branch-line);
  }

  .tree-gutter[data-mark='first']::after,
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

  .tree-gutter[data-active-vertical-top='true'][data-active-vertical-bottom='true']::before {
    background: var(--tree-path-line);
  }

  .tree-gutter[data-active-vertical-top='true'][data-active-vertical-bottom='false']::before {
    background: linear-gradient(
      to bottom,
      var(--tree-path-line) 0,
      var(--tree-path-line) 50%,
      var(--tree-branch-line) 50%,
      var(--tree-branch-line) 100%
    );
  }

  .tree-gutter[data-active-vertical-top='false'][data-active-vertical-bottom='true']::before {
    background: linear-gradient(
      to bottom,
      var(--tree-branch-line) 0,
      var(--tree-branch-line) 50%,
      var(--tree-path-line) 50%,
      var(--tree-path-line) 100%
    );
  }

  .tree-gutter[data-active-horizontal='true']::after {
    background: var(--tree-path-line);
  }
</style>
