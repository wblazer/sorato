<script lang="ts">
	import { Select as SelectPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SelectPrimitive.ScrollDownButtonProps> = $props();
</script>

<SelectPrimitive.ScrollDownButton
	bind:ref
	data-slot="select-scroll-down-button"
	class={cn("bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-surface py-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5", className)}
	{...restProps}
>
	<CaretDownIcon />
</SelectPrimitive.ScrollDownButton>
