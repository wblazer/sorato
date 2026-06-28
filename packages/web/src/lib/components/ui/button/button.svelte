<script lang="ts" module>
  import { cn, type WithElementRef } from '$lib/utils.js'
  import type {
    HTMLAnchorAttributes,
    HTMLButtonAttributes,
  } from 'svelte/elements'
  import { type VariantProps, tv } from 'tailwind-variants'

  export const buttonVariants = tv({
    base: "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground hover:bg-accent-hover',
        outline:
          'border-border bg-surface text-foreground hover:bg-surface-hover aria-expanded:bg-selected aria-expanded:text-foreground',
        'outline-destructive':
          'border-border bg-surface text-danger-muted-foreground hover:bg-danger-muted aria-expanded:bg-danger-muted',
        ghost:
          'hover:bg-base-hover hover:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground',
        destructive:
          'border-danger bg-danger text-danger-foreground hover:bg-danger-hover focus-visible:border-danger focus-visible:ring-danger',
        'ghost-destructive':
          'text-danger-muted-foreground hover:bg-danger-muted aria-expanded:bg-danger-muted',
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 text-sm/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-7 gap-1.5 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-3 text-base/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4.5",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4",
        'icon-xs': "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-lg': "size-9 [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  })

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']
  export type ButtonSize = VariantProps<typeof buttonVariants>['size']

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant
      size?: ButtonSize
    }
</script>

<script lang="ts">
  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props()
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
