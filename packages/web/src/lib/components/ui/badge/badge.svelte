<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const badgeVariants = tv({
		base: "h-5 gap-1 rounded-full border border-transparent px-2 py-0.5 text-[0.625rem] font-medium has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-2.5! focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-danger/30 aria-invalid:border-danger group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>svg]:pointer-events-none",
		variants: {
			variant: {
				default: "bg-accent text-accent-foreground [a]:hover:bg-accent/80",
				secondary: "bg-surface text-foreground [a]:hover:bg-surface/80",
				destructive: "bg-danger/15 [a]:hover:bg-danger/20 focus-visible:ring-danger/30 text-danger",
				outline: "border-border text-foreground [a]:hover:bg-base-hover [a]:hover:text-muted-foreground bg-surface",
				ghost: "hover:bg-base-hover hover:text-foreground",
				link: "text-accent underline-offset-4 hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = "default",
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
