<script lang="ts">
  import { onDestroy } from 'svelte'
  import LoadingState from '$lib/components/loading-state.svelte'
  import { messagesStore } from '$lib/stores/messages.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import type { SelectedHead } from '$lib/selected-head-storage.js'
  import type { MessageNode } from '$lib/types.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon'
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon'
  import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon'
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon'
  import {
    buildMessageTree,
    messageNarrativePreview,
    messagePreview,
    isToolMessage,
    pathIdsForHead,
    runTreeNodeId,
    summarizeAssistantToolExchange,
    type MessageTreeNode,
    type ToolCallSummary,
  } from './session-tree.js'
  import type { SessionSelectedHeadController } from './session-selected-head.svelte.js'
  import { iconForMessageName, roleIcons } from './message-icons.js'
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
  let compactDragCleanup: (() => void) | null = null
  let compactDragFixedNodeId = $state<string | null>(null)

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
        readonly childCount: number
        readonly toolCallCount: number
        readonly toolCalls: ReadonlyArray<ToolCallSummary>
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
  const rows = $derived.by(() =>
    flattenRows(tree, activeRuns, selectedPathIds, selectedHeadValue),
  )
  const compactRows = $derived.by(() =>
    rows.filter(
      (row): row is Extract<TreeRow, { type: 'node' }> =>
        row.type === 'node' &&
        canCompactMessage(row.message) &&
        row.coveredNodeIds.some((id) => selectedPathIds.has(id)),
    ),
  )
  const baseHeadNodeId = $derived.by(() =>
    selectedHeadValue?.type === 'node' ? selectedHeadValue.nodeId : null,
  )

  function flattenRows(
    roots: ReadonlyArray<MessageTreeNode>,
    runs: ReadonlyArray<ActiveRun>,
    selectedPathIds: ReadonlySet<string>,
    selectedHead: SelectedHead,
  ): ReadonlyArray<TreeRow> {
    const rows: TreeRow[] = []
    const runsByBase = new Map<string | null, ActiveRun[]>()
    const effectiveRunBase = (run: ActiveRun): string | null => {
      if (run.kind !== 'agent') return run.baseNodeId
      return (
        latestRunLeaf(messages, run.runId, run.baseNodeId)?.id ?? run.baseNodeId
      )
    }

    for (const run of runs) {
      const baseNodeId = effectiveRunBase(run)
      const siblings = runsByBase.get(baseNodeId) ?? []
      siblings.push(run)
      runsByBase.set(baseNodeId, siblings)
    }

    const nodeContainsSelectedPath = (node: MessageTreeNode): boolean => {
      if (selectedPathIds.has(node.message.id)) return true
      return node.children.some(nodeContainsSelectedPath)
    }

    const runContainsSelectedPath = (run: ActiveRun): boolean =>
      selectedHead?.type === 'run' && selectedHead.runId === run.runId

    const visit = (
      node: MessageTreeNode,
      structuralDepth: number,
      branchGutters: ReadonlyArray<BranchGutter>,
      branchConnector: BranchConnector,
      parentConnector: boolean,
      activeParentConnector: boolean,
      activeBranchVertical: boolean,
      activeBranchHorizontal: boolean,
    ) => {
      const visualDepth = structuralDepth

      if (isToolMessage(node.message)) {
        for (const child of node.children) {
          visit(
            child,
            structuralDepth,
            branchGutters,
            branchConnector,
            parentConnector,
            activeParentConnector,
            activeBranchVertical,
            activeBranchHorizontal,
          )
        }
        for (const run of runsByBase.get(node.message.id) ?? []) {
          const activeRun = runContainsSelectedPath(run)
          rows.push({
            type: 'run',
            id: runTreeNodeId(run.runId),
            structuralDepth,
            visualDepth,
            branchConnector: null,
            branchGutters,
            parentConnector: true,
            childConnector: false,
            activeParentConnector: activeRun,
            activeChildConnector: false,
            activeBranchVertical: activeRun,
            activeBranchHorizontal: activeRun,
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
      const toolCalls = toolExchange?.toolCalls ?? []
      const unresolvedToolCallCount =
        toolExchange === null
          ? 0
          : toolExchange.toolCallCount - toolExchange.resolvedToolResultCount
      const childCount =
        continuationChildren.length +
        (runsByBase.get(targetNodeId)?.length ?? 0)
      const nodeInPath = coveredNodeIds.some((id) => selectedPathIds.has(id))
      rows.push({
        type: 'node',
        id: node.message.id,
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
        message: node.message,
        targetNodeId,
        coveredNodeIds,
        childCount,
        toolCallCount,
        toolCalls,
        unresolvedToolCallCount,
        canSelect: unresolvedToolCallCount === 0,
      })

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
      ].sort(
        (a, b) =>
          Number(childEntryContainsSelectedPath(b)) -
          Number(childEntryContainsSelectedPath(a)),
      )
      const selectedChildIndex = childEntries.findIndex(
        childEntryContainsSelectedPath,
      )

      if (nodeInPath && selectedChildIndex >= 0) {
        const row = rows[rows.length - 1]
        rows[rows.length - 1] = { ...row, activeChildConnector: true }
      }

      childEntries.forEach((entry, index) => {
        const isLastChild = index === childEntries.length - 1
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

        if (entry.type === 'node') {
          const entryInPath = nodeContainsSelectedPath(entry.node)
          visit(
            entry.node,
            childStructuralDepth,
            nextGutters,
            childConnector,
            childConnector === null,
            childConnector === null && nodeInPath && entryInPath,
            selectedChildIndex >= 0 && index <= selectedChildIndex,
            entryInPath,
          )
        } else {
          const activeRun = runContainsSelectedPath(entry.run)
          rows.push({
            type: 'run',
            id: runTreeNodeId(entry.run.runId),
            structuralDepth: childStructuralDepth,
            visualDepth: childStructuralDepth,
            branchConnector: childConnector,
            branchGutters: nextGutters,
            parentConnector: childConnector === null,
            childConnector: false,
            activeParentConnector:
              childConnector === null && nodeInPath && activeRun,
            activeChildConnector: false,
            activeBranchVertical:
              selectedChildIndex >= 0 && index <= selectedChildIndex,
            activeBranchHorizontal: activeRun,
            run: entry.run,
          })
        }
      })
    }

    const orderedRoots = [...roots].sort(
      (a, b) =>
        Number(nodeContainsSelectedPath(b)) -
        Number(nodeContainsSelectedPath(a)),
    )
    for (const root of orderedRoots)
      visit(root, 0, [], null, false, false, false, false)
    for (const run of runsByBase.get(null) ?? []) {
      const activeRun = runContainsSelectedPath(run)
      rows.push({
        type: 'run',
        id: runTreeNodeId(run.runId),
        structuralDepth: 0,
        visualDepth: 0,
        branchConnector: null,
        branchGutters: [],
        parentConnector: false,
        childConnector: false,
        activeParentConnector: false,
        activeChildConnector: false,
        activeBranchVertical: activeRun,
        activeBranchHorizontal: activeRun,
        run,
      })
    }

    return rows

    function childEntryContainsSelectedPath(
      entry:
        | { readonly type: 'node'; readonly node: MessageTreeNode }
        | { readonly type: 'run'; readonly run: ActiveRun },
    ) {
      return entry.type === 'node'
        ? nodeContainsSelectedPath(entry.node)
        : runContainsSelectedPath(entry.run)
    }
  }

  function latestRunLeaf(
    messages: ReadonlyArray<MessageNode>,
    runId: string,
    baseNodeId: string | null,
  ): MessageNode | null {
    const runMessages = messages.filter(
      (message) =>
        message.runId === runId &&
        isDescendantOrSame(messages, message.id, baseNodeId),
    )
    const runIds = new Set(runMessages.map((message) => message.id))
    const parentIds = new Set(
      runMessages
        .map((message) => message.parentId)
        .filter((id): id is string => id !== null && runIds.has(id)),
    )

    const runLeaf = runMessages
      .toReversed()
      .find((message) => !parentIds.has(message.id))
    if (runLeaf) return runLeaf

    const branchSwitchedRunMessages = messages.filter(
      (message) => message.runId === runId,
    )
    const branchSwitchedRunIds = new Set(
      branchSwitchedRunMessages.map((message) => message.id),
    )
    const branchSwitchedParentIds = new Set(
      branchSwitchedRunMessages
        .map((message) => message.parentId)
        .filter(
          (id): id is string => id !== null && branchSwitchedRunIds.has(id),
        ),
    )

    return (
      branchSwitchedRunMessages
        .toReversed()
        .find((message) => !branchSwitchedParentIds.has(message.id)) ?? null
    )
  }

  function isDescendantOrSame(
    messages: ReadonlyArray<MessageNode>,
    nodeId: string,
    ancestorId: string | null,
  ) {
    if (ancestorId === null) return true

    const byId = new Map(messages.map((message) => [message.id, message]))
    const seen = new Set<string>()
    let cursor: string | null = nodeId

    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === ancestorId) return true
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }

    return false
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
    const startNodeId = startRow?.message.id
    const orderedEndNodeId = endRow?.targetNodeId
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

  function canCompactMessage(message: MessageNode) {
    return (
      message.kind !== 'message' ||
      message.encoded.role !== 'system' ||
      (message.encoded.source !== 'system-prompt' &&
        message.encoded.source !== 'agents-md')
    )
  }

  function rowPreview(row: Extract<TreeRow, { type: 'node' }>) {
    if (row.toolCallCount === 0) return messagePreview(row.message)
    return messageNarrativePreview(row.message)
  }

  function toolBadges(row: Extract<TreeRow, { type: 'node' }>) {
    return row.toolCalls
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
        <div class="border-b border-border p-2">
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
        </div>
        <div class="border-b border-border">
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
                  {#if row.toolCallCount > 0}
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
                </span>
              </Button>
            {/each}
          </div>
          <div class="p-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              class="w-full"
              disabled={compactStartNodeId === null}
              onclick={clearCompactSelection}
            >
              Clear selection
            </Button>
          </div>
        </div>
        <div class="flex flex-col gap-2 p-2">
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
        <div class="sticky top-0 z-10 border-b border-border bg-background p-2">
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
                  {#if row.toolCallCount > 0}
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
                  data-tone={row.run.kind === 'summary'
                    ? 'summary'
                    : 'assistant'}
                  data-in-path="true"
                  data-parent-connector={row.parentConnector}
                  data-child-connector={row.childConnector}
                  data-active-parent-connector={row.activeParentConnector}
                  data-active-child-connector={row.activeChildConnector}
                >
                  <CircleNotchIcon class="size-3.5 animate-spin" />
                </span>
                <span class="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    class="tree-preview shrink-0 truncate text-sm font-normal text-foreground"
                    data-tone={row.run.kind === 'summary'
                      ? 'summary'
                      : 'assistant'}
                  >
                    {row.run.kind === 'summary'
                      ? 'Summarizing range'
                      : 'Streaming branch'}
                  </span>
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
