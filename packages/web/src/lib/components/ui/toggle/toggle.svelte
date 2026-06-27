<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants'

  export const toggleVariants = tv({
    base: "hover:text-foreground aria-pressed:bg-selected focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-danger/30 aria-invalid:border-danger data-[state=on]:bg-selected gap-1.5 rounded-md text-sm font-medium [&_svg:not([class*='size-'])]:size-4 group/toggle hover:bg-base-hover inline-flex items-center justify-center whitespace-nowrap outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border-border hover:bg-base-hover border bg-transparent',
      },
      size: {
        default:
          'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),8px)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 gap-2 px-3 text-base has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  })

  export type ToggleVariant = VariantProps<typeof toggleVariants>['variant']
  export type ToggleSize = VariantProps<typeof toggleVariants>['size']
  export type ToggleVariants = VariantProps<typeof toggleVariants>
</script>

<script lang="ts">
  import { Toggle as TogglePrimitive } from 'bits-ui'
  import { cn } from '$lib/utils.js'

  let {
    ref = $bindable(null),
    pressed = $bindable(false),
    class: className,
    size = 'default',
    variant = 'default',
    ...restProps
  }: TogglePrimitive.RootProps & {
    variant?: ToggleVariant
    size?: ToggleSize
  } = $props()
</script>

<TogglePrimitive.Root
  bind:ref
  bind:pressed
  data-slot="toggle"
  class={cn(toggleVariants({ variant, size }), className)}
  {...restProps}
/>
