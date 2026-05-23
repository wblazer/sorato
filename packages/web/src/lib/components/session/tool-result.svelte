<script lang="ts">
  import type { ToolCallPart, ToolResultPart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { diffDisplaySummary } from '$lib/tool-output.js'
  import ToolDiff from './tool-diff.svelte'

  let {
    call,
    part,
  }: { call?: ToolCallPart | undefined; part: ToolResultPart } = $props()

  const summary = $derived(diffDisplaySummary(part.display))
  const shouldRenderPretty = $derived(
    clientSettingsStore.prettyToolOutput && part.display !== undefined
  )
  const title = $derived(call?.display?.title ?? call?.name ?? part.name)
  const subtitle = $derived(call?.display?.subtitle ?? summary?.fileName)
</script>

<div
  class="overflow-hidden rounded-md border {part.isFailure
    ? 'border-danger bg-inset'
    : 'border-border bg-inset'}"
>
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2.5 py-2 text-sm {part.isFailure
      ? 'border-danger text-danger'
      : 'border-border text-foreground'}"
  >
    <span class="font-semibold">{title}</span>
    {#if subtitle}
      <span class="text-muted-foreground">—</span>
      <span class="min-w-0 truncate font-mono text-xs text-muted-foreground">
        {subtitle}
      </span>
    {/if}
    {#if summary}
      <span class="ml-auto flex shrink-0 items-center gap-1 font-mono text-xs">
        <span class="text-success-muted-foreground">+{summary.additions}</span>
        <span class="text-danger">-{summary.deletions}</span>
      </span>
    {/if}
  </div>

  {#if shouldRenderPretty && part.display?.type === 'diff'}
    <ToolDiff display={part.display} />
  {:else}
    <pre class="max-h-64 overflow-auto px-2.5 py-3 text-sm leading-relaxed"
      >{part.result}</pre
    >
  {/if}
</div>
