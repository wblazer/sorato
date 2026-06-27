<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from 'bits-ui'
  import { cn } from '$lib/utils.js'
  import ContextMenuPortal from './context-menu-portal.svelte'
  import type { ComponentProps } from 'svelte'
  import type { WithoutChildrenOrChild } from '$lib/utils.js'

  let {
    ref = $bindable(null),
    portalProps,
    class: className,
    ...restProps
  }: ContextMenuPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<
      ComponentProps<typeof ContextMenuPortal>
    >
  } = $props()
</script>

<ContextMenuPortal {...portalProps}>
  <ContextMenuPrimitive.Content
    bind:ref
    data-slot="context-menu-content"
    class={cn(
      'no-scrollbar ring-border bg-popover text-foreground min-w-32 rounded-lg p-1 shadow-md ring-1 z-50 overflow-x-hidden overflow-y-auto outline-none',
      className,
    )}
    {...restProps}
  />
</ContextMenuPortal>
