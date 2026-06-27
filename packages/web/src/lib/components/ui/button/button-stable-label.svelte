<script lang="ts">
  import { cn } from '$lib/utils.js'
  import type { Snippet } from 'svelte'

  export type ButtonStableLabelState = 'idle' | 'pending' | 'success'

  let {
    value,
    idle,
    pending,
    success,
    class: className,
  }: {
    value: ButtonStableLabelState
    idle: Snippet
    pending: Snippet
    success: Snippet
    class?: string
  } = $props()
</script>

<span class={cn('grid gap-[inherit]', className)}>
  <span
    class={cn(
      'col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]',
      value !== 'idle' && 'invisible',
    )}
  >
    {@render idle()}
  </span>
  <span
    class={cn(
      'col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]',
      value !== 'pending' && 'invisible',
    )}
  >
    {@render pending()}
  </span>
  <span
    class={cn(
      'col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]',
      value !== 'success' && 'invisible',
    )}
  >
    {@render success()}
  </span>
</span>
