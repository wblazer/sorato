<script lang="ts">
  import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js'
  import type { HTMLTextareaAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    'data-slot': dataSlot = 'textarea',
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props()
</script>

<textarea
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    'flex min-h-16 w-full field-sizing-content resize-none rounded-md border border-border bg-background px-2 py-2 text-sm transition-colors placeholder:text-muted outline-none focus-visible:border-blue focus-visible:ring-2 focus-visible:ring-blue aria-invalid:border-red aria-invalid:ring-2 aria-invalid:ring-red disabled:cursor-not-allowed md:text-xs/relaxed',
    className
  )}
  bind:value
  {...restProps}
></textarea>
