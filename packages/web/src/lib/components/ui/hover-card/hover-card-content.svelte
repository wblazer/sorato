<script lang="ts">
  import { LinkPreview as HoverCardPrimitive } from 'bits-ui'
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js'
  import HoverCardPortal from './hover-card-portal.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    class: className,
    align = 'center',
    sideOffset = 4,
    portalProps,
    ...restProps
  }: HoverCardPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof HoverCardPortal>>
  } = $props()
</script>

<HoverCardPortal {...portalProps}>
  <HoverCardPrimitive.Content
    bind:ref
    data-slot="hover-card-content"
    {align}
    {sideOffset}
    class={cn(
      'ring-border bg-popover text-foreground w-72 rounded-lg p-2.5 text-xs/relaxed shadow-md ring-1 z-50 origin-(--transform-origin) outline-hidden',
      className,
    )}
    {...restProps}
  />
</HoverCardPortal>
