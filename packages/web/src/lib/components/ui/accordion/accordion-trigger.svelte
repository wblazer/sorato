<script lang="ts">
  import { Accordion as AccordionPrimitive } from 'bits-ui'
  import { cn, type WithoutChild } from '$lib/utils.js'
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown'
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUp'

  let {
    ref = $bindable(null),
    class: className,
    level = 3,
    children,
    ...restProps
  }: WithoutChild<AccordionPrimitive.TriggerProps> & {
    level?: AccordionPrimitive.HeaderProps['level']
  } = $props()
</script>

<AccordionPrimitive.Header {level} class="sticky top-0 z-20 flex">
  <AccordionPrimitive.Trigger
    data-slot="accordion-trigger"
    bind:ref
    class={cn(
      '**:data-[slot=accordion-trigger-icon]:text-muted-foreground gap-6 p-2 text-left text-xs/relaxed font-medium hover:underline **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 group/accordion-trigger relative flex flex-1 items-start justify-between border border-transparent outline-none disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
    <CaretDownIcon
      data-slot="accordion-trigger-icon"
      class="cn-accordion-trigger-icon pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
    />
    <CaretUpIcon
      data-slot="accordion-trigger-icon"
      class="cn-accordion-trigger-icon pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
    />
  </AccordionPrimitive.Trigger>
</AccordionPrimitive.Header>
