<script lang="ts">
  import type { ModelCall } from '$lib/types.js'
  import type { TranscriptItem } from '$lib/transcript.js'
  import MessagePartComponent from './message-part.svelte'
  import ToolCallResult from './tool-call-result.svelte'

  let {
    items,
    modelCall = null,
    isRunning = false,
    reserveMetaSpace = false,
    accordionState,
    accordionKey,
  }: {
    items: ReadonlyArray<TranscriptItem>
    modelCall?: ModelCall | null
    isRunning?: boolean
    reserveMetaSpace?: boolean
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  const transcriptItemKind = (item: TranscriptItem): string => {
    if (item.type === 'combined-tool') return 'tool'
    if (item.type === 'message') {
      return item.part.type === 'tool-call' || item.part.type === 'tool-result'
        ? 'tool'
        : item.part.type
    }
    return item.type
  }

  const itemAccordionKey = (item: TranscriptItem, index: number): string => {
    if (item.type === 'combined-tool')
      return `${accordionKey}:tool:${item.call.id}`
    if (item.type === 'message' && 'id' in item.part) {
      return `${accordionKey}:part:${item.part.id}`
    }
    return `${accordionKey}:item:${index}`
  }

  const formatCost = (micros: number): string =>
    Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: micros === 0 ? 0 : 4,
    }).format(micros / 1_000_000)

  const formatDuration = (milliseconds: number): string => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  const runtimeLine = $derived.by(() => {
    if (modelCall === null) return null
    if (modelCall.startedAt === null) return null

    return formatDuration(modelCall.finishedAt - modelCall.startedAt)
  })

  const costLine = $derived.by(() => {
    if (modelCall === null) return null
    if (modelCall.actualCostMicrosUsd === null) return null

    return formatCost(modelCall.actualCostMicrosUsd)
  })

  const hasMeta = $derived(runtimeLine !== null || costLine !== null)
  const startsWithTool = $derived(
    items[0] !== undefined && transcriptItemKind(items[0]) === 'tool',
  )
</script>

<div
  class={startsWithTool
    ? 'assistant-message pt-0.5 pb-2.5'
    : 'assistant-message py-2.5'}
>
  {#if items.length > 0}
    {#each items as item, index}
      <div
        class="assistant-transcript-item"
        data-transcript-kind={transcriptItemKind(item)}
      >
        {#if item.type === 'combined-tool'}
          <ToolCallResult
            call={item.call}
            result={item.result}
            {accordionState}
            accordionKey={itemAccordionKey(item, index)}
          />
        {:else if item.type === 'interruption'}
          <div
            class="flex items-center gap-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            <div class="h-px flex-1 bg-border"></div>
            <span>Interrupted</span>
            <div class="h-px flex-1 bg-border"></div>
          </div>
        {:else}
          <MessagePartComponent
            part={item.part}
            monospace={false}
            {accordionState}
            accordionKey={itemAccordionKey(item, index)}
          />
        {/if}
      </div>
    {/each}
  {/if}

  {#if hasMeta || isRunning || reserveMetaSpace}
    <div
      class="assistant-meta flex h-4 items-center gap-1.5 text-xs text-muted-foreground"
      class:assistant-meta-visible={isRunning}
      class:mt-2={items.length > 0}
    >
      {#if hasMeta}
        {#if runtimeLine}
          <span>{runtimeLine}</span>
        {/if}
        {#if costLine}
          {#if runtimeLine}
            <span>·</span>
          {/if}
          <span>{costLine}</span>
        {/if}
      {:else if isRunning}
        <span class="sr-only">Streaming</span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/50"
          aria-hidden="true"
        ></span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/50"
          style="animation-delay: 150ms"
          aria-hidden="true"
        ></span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/50"
          style="animation-delay: 300ms"
          aria-hidden="true"
        ></span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .assistant-transcript-item + .assistant-transcript-item {
    margin-top: 0.75rem;
  }

  .assistant-transcript-item[data-transcript-kind='tool']
    + .assistant-transcript-item[data-transcript-kind='tool'] {
    margin-top: 0.5rem;
  }

  .assistant-transcript-item[data-transcript-kind='tool']
    + .assistant-transcript-item:not([data-transcript-kind='tool']),
  .assistant-transcript-item:not([data-transcript-kind='tool'])
    + .assistant-transcript-item[data-transcript-kind='tool'] {
    margin-top: 1.25rem;
  }

  .assistant-meta {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .assistant-message:hover .assistant-meta,
  .assistant-message:focus-within .assistant-meta,
  .assistant-meta-visible {
    opacity: 1;
  }
</style>
