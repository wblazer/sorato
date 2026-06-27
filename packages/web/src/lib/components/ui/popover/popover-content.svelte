<script lang="ts">
  import { Popover as PopoverPrimitive } from 'bits-ui'
  import type { ComponentProps } from 'svelte'
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js'
  import PopoverPortal from './popover-portal.svelte'

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    align = 'center',
    portalProps,
    ...restProps
  }: PopoverPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>
  } = $props()
</script>

<PopoverPortal {...portalProps}>
  <PopoverPrimitive.Content
    bind:ref
    data-slot="popover-content"
    {sideOffset}
    {align}
    class={cn(
      'bg-popover text-foreground data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-lg p-2.5 text-xs shadow-md shadow-shadow/40 ring-1 ring-border outline-hidden',
      className,
    )}
    {...restProps}
  />
</PopoverPortal>
