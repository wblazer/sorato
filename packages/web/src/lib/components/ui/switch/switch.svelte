<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		size = "default",
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	data-size={size}
	class={cn(
		"data-checked:bg-accent data-unchecked:bg-surface focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-danger aria-invalid:ring-danger/30 shrink-0 rounded-full border border-transparent transition-colors focus-visible:ring-2 aria-invalid:ring-2 data-[size=default]:h-[22px] data-[size=default]:w-[38px] data-[size=sm]:h-[16.6px] data-[size=sm]:w-[28px] peer group/switch relative inline-flex items-center outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class="bg-background data-unchecked:bg-foreground data-checked:bg-accent-foreground rounded-full transition-transform group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-3.5 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 pointer-events-none block ring-0 rtl:data-[state=checked]:translate-x-[calc(-100%)]"
	/>
</SwitchPrimitive.Root>
