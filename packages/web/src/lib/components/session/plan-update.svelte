<script lang="ts">
  import type { ToolCallPart, ToolResultPart } from '$lib/types.js'
  import { decodePlanSnapshot, planProgress } from '$lib/plan-presentation.js'

  let {
    call,
    result,
  }: {
    call: ToolCallPart
    result?: ToolResultPart | undefined
  } = $props()

  const snapshot = $derived(decodePlanSnapshot(call.params))
  const progress = $derived(snapshot ? planProgress(snapshot) : undefined)
  const failed = $derived(result?.isFailure === true)
  const label = $derived(
    failed
      ? 'Plan update failed'
      : result === undefined
        ? 'Updating plan'
        : 'Updated plan',
  )
</script>

<div
  class="flex min-h-6 items-center gap-2 text-xs text-muted-foreground"
  aria-label={label}
>
  <span>{label}</span>
  {#if snapshot && progress}
    {#if progress.total > 1}
      <span class="flex shrink-0 items-center gap-0.5" aria-hidden="true">
        {#each snapshot.plan as step}
          <span
            class="h-0.5 w-2.5 rounded-full {step.status === 'completed'
              ? 'bg-accent'
              : step.status === 'in_progress'
                ? 'bg-foreground'
                : 'bg-muted-foreground/25'}"
          ></span>
        {/each}
      </span>
    {/if}
    <span class="tabular-nums">{progress.completed}/{progress.total}</span>
  {/if}
  {#if failed && result}
    <span class="min-w-0 truncate">{result.result}</span>
  {/if}
</div>
