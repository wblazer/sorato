<script lang="ts">
  import type { ToolCallPart, ToolResultPart } from '$lib/types.js'
  import MessageIcon from './message-icon.svelte'
  import ToolResult from './tool-result.svelte'
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon'

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
  <div class="rounded-md border border-border bg-inset">
    <div
      class="grid grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)] items-start gap-x-2 gap-y-1 border-b border-border px-2.5 py-2 text-sm text-foreground"
    >
      <CircleNotchIcon
        class="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
      />
      <span class="whitespace-nowrap font-semibold leading-5">{title}</span>
      {#if subtitle}
        <span
          class="line-clamp-3 min-w-0 whitespace-normal break-words font-mono leading-5 text-muted-foreground [overflow-wrap:anywhere]"
        >
          {subtitle}
        </span>
      {/if}
    </div>
  </div>
{/if}
