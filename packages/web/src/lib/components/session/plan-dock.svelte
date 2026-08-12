<script lang="ts">
  import type { PlanSnapshot } from '$lib/plan-presentation.js'
  import { planProgress } from '$lib/plan-presentation.js'
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'

  let { snapshot }: { snapshot: PlanSnapshot } = $props()

  let expanded = $state(false)
  const progress = $derived(planProgress(snapshot))
</script>

<div
  class="relative z-0 -mb-2 overflow-hidden rounded-t-lg border border-border bg-inset pb-2 text-sm"
  aria-label="Current plan"
>
  <button
    type="button"
    class="flex h-9 w-full items-center gap-2 px-3 text-left text-muted-foreground outline-none hover:bg-inset-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <CaretDownIcon
      class="size-3.5 shrink-0 transition-transform {expanded
        ? ''
        : '-rotate-90'}"
    />
    {#if progress.total > 1}
      <span class="flex shrink-0 items-center gap-0.5" aria-hidden="true">
        {#each snapshot.plan as step}
          <span
            class="h-0.5 w-3 rounded-full {step.status === 'completed'
              ? 'bg-accent'
              : step.status === 'in_progress'
                ? 'bg-foreground'
                : 'bg-muted-foreground/25'}"
          ></span>
        {/each}
      </span>
    {/if}
    <span class="min-w-0 flex-1 truncate text-foreground">
      {progress.activeStep?.step ?? 'Plan'}
    </span>
    <span class="shrink-0 tabular-nums text-muted-foreground">
      {progress.completed}/{progress.total}
    </span>
  </button>

  {#if expanded}
    <ol class="space-y-0.5 px-3 pb-2 pl-9">
      {#each snapshot.plan as item}
        <li class="flex items-baseline gap-2 leading-5">
          <span
            class="w-3 shrink-0 text-center font-mono text-xs {item.status ===
            'completed'
              ? 'text-accent'
              : item.status === 'in_progress'
                ? 'text-foreground'
                : 'text-muted-foreground'}"
            aria-hidden="true"
          >
            {item.status === 'completed'
              ? '✓'
              : item.status === 'in_progress'
                ? '●'
                : '○'}
          </span>
          <span
            class={item.status === 'in_progress'
              ? 'text-foreground'
              : 'text-muted-foreground'}
          >
            {item.step}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</div>
