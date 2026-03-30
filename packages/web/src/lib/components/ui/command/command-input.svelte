<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import * as InputGroup from "$lib/components/ui/input-group/index.js";
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: CommandPrimitive.InputProps = $props();
</script>

<div data-slot="command-input-wrapper" class="p-1 pb-0">
	<InputGroup.Root class="bg-input/20 dark:bg-input/30 h-8!">
		<CommandPrimitive.Input
			data-slot="command-input"
			class={cn(
				"w-full text-sm/relaxed outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
			bind:ref
			{...restProps}
			bind:value
		/>
		<InputGroup.Addon>
			<MagnifyingGlassIcon class="size-3.5 shrink-0 opacity-50" />
		</InputGroup.Addon>
	</InputGroup.Root>
</div>
