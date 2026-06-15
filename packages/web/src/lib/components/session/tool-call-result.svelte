<script lang="ts">
  import type { ToolCallPart, ToolResultPart } from '$lib/types.js'
  import MessageIcon from './message-icon.svelte'
  import ToolResult from './tool-result.svelte'

  let {
    call,
    result,
    accordionState,
    accordionKey,
  }: {
    call: ToolCallPart
    result?: ToolResultPart | undefined
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  const title = $derived(call.header?.title ?? call.name)
  const subtitle = $derived(call.header?.subtitle)
</script>

{#if result}
  <ToolResult {call} part={result} {accordionState} {accordionKey} />
{:else}
  <div class="overflow-hidden rounded-md border border-border bg-inset">
    <div
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2.5 py-2 text-sm text-foreground"
    >
      <MessageIcon name={call.header?.icon} />
      <span class="font-semibold">{title}</span>
      {#if subtitle}
        <span class="min-w-0 truncate font-mono text-muted-foreground">
          {subtitle}
        </span>
      {/if}
    </div>
  </div>
{/if}
