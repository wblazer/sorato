<script lang="ts">
	import { sessionStore } from "$lib/stores/sessions.svelte.js";
	import DirectoryPicker from "$lib/components/directory-picker.svelte";
	import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import { cn } from "$lib/utils.js";

	let open = $state(false);
	let pickerOpen = $state(false);
	let triggerEl: HTMLButtonElement | null = $state(null);

	const directoryName = $derived(
		sessionStore.selectedDirectory.split("/").pop() ?? "",
	);

	function handleWindowClick(e: MouseEvent) {
		if (triggerEl && !triggerEl.contains(e.target as Node)) {
			open = false;
		}
	}

	function selectDirectory(dir: string) {
		sessionStore.selectDirectory(dir);
		open = false;
	}

	function handleOpenDirectory() {
		open = false;
		pickerOpen = true;
	}

	function handlePickerSelect(path: string) {
		sessionStore.openDirectory(path);
	}
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative" data-slot="directory-selector">
	<button
		bind:this={triggerEl}
		class={cn(
			"flex w-full items-center gap-3 rounded-md px-3 py-2.5",
			"hover:bg-sidebar-accent transition-colors",
			"text-left",
		)}
		onclick={() => (open = !open)}
	>
		<div class="min-w-0 flex-1">
			{#if sessionStore.selectedDirectory}
				<div class="truncate text-sm font-semibold text-sidebar-foreground">
					{directoryName}
				</div>
				<div class="truncate text-xs text-muted-foreground">
					{sessionStore.selectedDirectory}
				</div>
			{:else}
				<div class="text-sm text-muted-foreground">
					No directory selected
				</div>
			{/if}
		</div>
		<ChevronsUpDown
			class={cn("size-4 shrink-0 text-muted-foreground transition-transform")}
		/>
	</button>

	{#if open}
		<div
			class={cn(
				"absolute top-full left-0 z-50 mt-1 w-full",
				"rounded-md border bg-popover p-1 shadow-md",
				"animate-in fade-in-0 zoom-in-95",
			)}
		>
			{#each sessionStore.directories as dir}
				{@const name = dir.split("/").pop() ?? ""}
				{@const isSelected = dir === sessionStore.selectedDirectory}
				<button
					class={cn(
						"flex w-full flex-col rounded-sm px-2.5 py-2 text-left transition-colors",
						isSelected
							? "bg-accent text-accent-foreground"
							: "hover:bg-accent/50",
					)}
					onclick={() => selectDirectory(dir)}
				>
					<span class="truncate text-sm font-medium">{name}</span>
					<span class="truncate text-xs text-muted-foreground">{dir}</span>
				</button>
			{/each}

			<div class="my-1 h-px bg-border"></div>

			<button
				class={cn(
					"flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors",
					"text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
				)}
				onclick={handleOpenDirectory}
			>
				<FolderOpen class="size-4" />
				Open Directory…
			</button>
		</div>
	{/if}
</div>

{#if pickerOpen}
	<DirectoryPicker bind:open={pickerOpen} onSelect={handlePickerSelect} />
{/if}
