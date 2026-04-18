<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { Button } from '$lib/components/ui/button/index.js'
  import { cn, type WithElementRef } from '$lib/utils.js'
  import DialogClose from './dialog-close.svelte'

  let {
    ref = $bindable(null),
    class: className,
    children,
    showCloseButton = false,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    showCloseButton?: boolean
  } = $props()
</script>

<div
  bind:this={ref}
  data-slot="dialog-footer"
  class={cn(
    'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
    className
  )}
  {...restProps}
>
  {@render children?.()}
  {#if showCloseButton}
    <DialogClose>
      {#snippet child({ props })}
        <Button variant="outline" {...props}>Close</Button>
      {/snippet}
    </DialogClose>
  {/if}
</div>
