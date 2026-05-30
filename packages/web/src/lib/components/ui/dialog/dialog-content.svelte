<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui'
      import type { ComponentProps, Snippet } from 'svelte'
      import XIcon from 'phosphor-svelte/lib/XIcon'
      import { Button } from '$lib/components/ui/button/index.js'
      import { cn, type WithoutChildrenOrChild } from '$lib/utils.js'
      import * as Dialog from './index.js'
      import DialogPortal from './dialog-portal.svelte'

      let {
        ref = $bindable(null),
        class: className,
        portalProps,
        children,
        showCloseButton = true,
        ...restProps
      }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
        portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>
        children: Snippet
        showCloseButton?: boolean
      } = $props()
</script>

<DialogPortal {...portalProps}>
  <Dialog.Overlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      'bg-background ring-border fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-5 text-sm/relaxed shadow-lg shadow-shadow/40 ring-1 outline-none sm:max-w-sm',
      className
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close data-slot="dialog-close">
        {#snippet child({ props })}
          <Button
            variant="ghost"
            class="absolute top-2 right-2"
            size="icon"
            {...props}
          >
            <XIcon />
            <span class="sr-only">Close</span>
          </Button>
        {/snippet}
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPortal>
