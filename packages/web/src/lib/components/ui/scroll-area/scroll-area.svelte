<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from "bits-ui";
	import { Scrollbar } from "./index.js";
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		viewportRef = $bindable(null),
		class: className,
		orientation = "vertical",
		scrollbarXClasses = "",
		scrollbarYClasses = "",
		viewportClass,
		onViewportScroll,
		onViewportWheel,
		children,
		...restProps
	}: WithoutChild<ScrollAreaPrimitive.RootProps> & {
		orientation?: "vertical" | "horizontal" | "both" | undefined;
		scrollbarXClasses?: string | undefined;
		scrollbarYClasses?: string | undefined;
		viewportClass?: string | undefined;
		onViewportScroll?: ((event: Event) => void) | undefined;
		onViewportWheel?: ((event: WheelEvent) => void) | undefined;
		viewportRef?: HTMLElement | null;
	} = $props();

</script>

<ScrollAreaPrimitive.Root
	bind:ref
	data-slot="scroll-area"
	class={cn("relative overflow-hidden", className)}
	{...restProps}
>
	<ScrollAreaPrimitive.Viewport
		bind:ref={viewportRef}
		data-slot="scroll-area-viewport"
		class={cn("cn-scroll-area-viewport no-scrollbar focus-visible:ring-ring/50 size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:outline-1", viewportClass)}
		onscroll={onViewportScroll}
		onwheel={onViewportWheel}
	>
		{@render children?.()}
	</ScrollAreaPrimitive.Viewport>
	{#if orientation === "vertical" || orientation === "both"}
		<Scrollbar orientation="vertical" class={scrollbarYClasses} />
	{/if}
	{#if orientation === "horizontal" || orientation === "both"}
		<Scrollbar orientation="horizontal" class={scrollbarXClasses} />
	{/if}
	<ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
