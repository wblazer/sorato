<script lang="ts">
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
    messagePreview,
    pathIdsForHead,
    runTreeNodeId,
    type MessageTreeNode,
  } from './session-tree.js'
  import type { SessionSelectedHeadController } from './session-selected-head.svelte.js'

  let {
    sessionId,
    selectedHead,
  }: {
    sessionId: string
    selectedHead: SessionSelectedHeadController
  } = $props()

  let activeTab = $state('tree')

  type ActiveRun = ReturnType<typeof sessionStore.activeRunsFor>[number]
  type TreeRow =
    | {
        readonly type: 'node'
        readonly id: string
        readonly depth: number
        readonly message: MessageNode
        readonly childCount: number
      }
    | {
        readonly type: 'run'
        readonly id: string
        readonly depth: number
        readonly run: ActiveRun
      }

  const tree = $derived(buildMessageTree(messagesStore.messages))
  const activeRuns = $derived(sessionStore.activeRunsFor(sessionId))
  const selectedPathIds = $derived(
    pathIdsForHead(messagesStore.messages, selectedHead.renderHead)
  )
  const selectedHeadValue = $derived(selectedHead.renderHead)
  const rows = $derived.by(() => flattenRows(tree, activeRuns))

  function flattenRows(
    roots: ReadonlyArray<MessageTreeNode>,
    runs: ReadonlyArray<ActiveRun>
  ): ReadonlyArray<TreeRow> {
    const rows: TreeRow[] = []
    const runsByBase = new Map<string | null, ActiveRun[]>()

    for (const run of runs) {
      const siblings = runsByBase.get(run.baseNodeId) ?? []
      siblings.push(run)
      runsByBase.set(run.baseNodeId, siblings)
    }

    const visit = (node: MessageTreeNode, depth: number) => {
      const childCount =
        node.children.length + (runsByBase.get(node.message.id)?.length ?? 0)
      rows.push({
        type: 'node',
        id: node.message.id,
        depth,
        message: node.message,
        childCount,
      })

      const childDepth = depth + (childCount > 1 ? 1 : 0)
      for (const child of node.children) visit(child, childDepth)
      for (const run of runsByBase.get(node.message.id) ?? []) {
        rows.push({
          type: 'run',
          id: runTreeNodeId(run.runId),
          depth: childDepth,
          run,
        })
      }
    }

    for (const run of runsByBase.get(null) ?? []) {
      rows.push({ type: 'run', id: runTreeNodeId(run.runId), depth: 0, run })
    }
    for (const root of roots) visit(root, 0)

    return rows
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

  function isSelectedNode(head: SelectedHead, nodeId: string) {
    return head?.type === 'node' && head.nodeId === nodeId
  }

  function isSelectedRun(head: SelectedHead, runId: string) {
    return head?.type === 'run' && head.runId === runId
  }

  function nodeIcon(message: MessageNode) {
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

<aside class="flex h-full w-full shrink-0 flex-col border-l border-border bg-background">
  <Tabs.Root bind:value={activeTab} class="min-h-0 flex-1 gap-0">
    <div class="flex h-[var(--session-header-height)] items-center border-b border-border px-3">
      <Tabs.List class="w-full" variant="default">
        <Tabs.Trigger value="tree">
          <GitBranchIcon />
          Tree
        </Tabs.Trigger>
        <Tabs.Trigger value="diff">Diff</Tabs.Trigger>
      </Tabs.List>
    </div>

    <Tabs.Content value="tree" class="min-h-0 overflow-auto">
      {#if messagesStore.loading}
        <div class="p-3 text-sm text-muted-foreground">Loading tree...</div>
      {:else if rows.length === 0}
        <div class="p-3 text-sm text-muted-foreground">No messages yet.</div>
      {:else}
        <div class="flex flex-col gap-0.5 p-1.5">
          {#each rows as row (row.id)}
            {@const inPath = selectedPathIds.has(row.id)}
            {#if row.type === 'node'}
              {@const selected = isSelectedNode(selectedHeadValue, row.message.id)}
              {@const Icon = nodeIcon(row.message)}
              <Button
                variant="ghost"
                size="sm"
                class="h-auto justify-start gap-1.5 px-1.5 py-1 text-left hover:bg-base-hover {selected ? 'bg-selected text-foreground hover:bg-selected' : ''}"
                style={`padding-left: ${0.375 + row.depth * 1.1}rem`}
                title={row.message.id}
                onclick={() => selectNode(row.message.id)}
              >
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-full border {inPath ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-foreground'}"
                >
                  <Icon class="size-3.5" />
                </span>
                <span class="flex min-w-0 flex-1 items-center gap-1.5">
                  <span class="truncate text-sm font-normal text-foreground">
                    {messagePreview(row.message)}
                  </span>
                  {#if row.childCount > 1}
                    <span class="shrink-0 rounded bg-muted px-1 text-[10px] text-foreground">
                      {row.childCount}
                    </span>
                  {/if}
                </span>
              </Button>
            {:else}
              {@const selected = isSelectedRun(selectedHeadValue, row.run.runId)}
              <Button
                variant="ghost"
                size="sm"
                class="h-auto justify-start gap-1.5 px-1.5 py-1 text-left hover:bg-base-hover {selected ? 'bg-selected text-foreground hover:bg-selected' : ''}"
                style={`padding-left: ${0.375 + row.depth * 1.1}rem`}
                title={row.run.runId}
                onclick={() => selectRun(row.run)}
              >
                <span class="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/60 bg-primary/10 text-primary">
                  <CircleNotchIcon class="size-3.5 animate-spin" />
                </span>
                <span class="min-w-0 flex-1 truncate text-sm font-normal text-foreground">
                  Streaming branch
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
          <h3 class="text-sm font-medium text-foreground">Diff panel coming soon</h3>
          <p class="text-sm text-muted-foreground">
            Code changes for this session will appear here.
          </p>
        </div>
      </div>
    </Tabs.Content>
  </Tabs.Root>
</aside>
