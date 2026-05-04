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
      'bg-surface data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-border fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-5 text-sm/relaxed shadow-lg shadow-shadow/40 ring-1 duration-100 outline-none sm:max-w-sm [&_[data-slot=button]:not([data-slot=dialog-close])]:h-8 [&_[data-slot=button]:not([data-slot=dialog-close])]:px-3 [&_[data-slot=button]:not([data-slot=dialog-close])]:text-sm [&_[data-slot=input]]:h-8 [&_[data-slot=input]]:text-sm [&_[data-slot=input-group]]:h-8',
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
