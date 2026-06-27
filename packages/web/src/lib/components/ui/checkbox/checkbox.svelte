<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from 'bits-ui'
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js'
  import CheckIcon from 'phosphor-svelte/lib/Check'
  import MinusIcon from 'phosphor-svelte/lib/Minus'

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props()
</script>

<CheckboxPrimitive.Root
  bind:ref
  data-slot="checkbox"
  class={cn(
    'border-border bg-surface data-checked:bg-accent data-checked:text-accent-foreground data-checked:border-accent aria-invalid:aria-checked:border-accent aria-invalid:border-danger focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-danger/30 flex size-4 items-center justify-center rounded-[4px] border group-has-disabled/field:opacity-50 focus-visible:ring-2 aria-invalid:ring-2 peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  bind:checked
  bind:indeterminate
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <div
      data-slot="checkbox-indicator"
      class="[&>svg]:size-3.5 grid place-content-center text-current"
    >
      {#if checked}
        <CheckIcon />
      {:else if indeterminate}
        <MinusIcon />
      {/if}
    </div>
  {/snippet}
</CheckboxPrimitive.Root>
