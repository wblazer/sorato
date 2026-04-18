<script lang="ts">
  import type {
        HTMLInputAttributes,
        HTMLInputTypeAttribute,
      } from 'svelte/elements'
      import { cn, type WithElementRef } from '$lib/utils.js'

      type InputType = Exclude<HTMLInputTypeAttribute, 'file'>

      type Props = WithElementRef<
        Omit<HTMLInputAttributes, 'type'> &
          (
            | { type: 'file'; files?: FileList }
            | { type?: InputType; files?: undefined }
          )
      >

      let {
        ref = $bindable(null),
        value = $bindable(),
        type,
        files = $bindable(),
        class: className,
        'data-slot': dataSlot = 'input',
        ...restProps
      }: Props = $props()
</script>

{#if type === 'file'}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      'h-7 w-full min-w-0 rounded-md border border-border bg-surface px-2 py-0.5 text-sm transition-colors placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger disabled:pointer-events-none disabled:cursor-not-allowed file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground md:text-xs/relaxed',
      className
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      'h-7 w-full min-w-0 rounded-md border border-border bg-surface px-2 py-0.5 text-sm transition-colors placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger disabled:pointer-events-none disabled:cursor-not-allowed file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground md:text-xs/relaxed',
      className
    )}
    {type}
    bind:value
    {...restProps}
  />
{/if}
