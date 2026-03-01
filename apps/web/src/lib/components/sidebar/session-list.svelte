<script lang="ts">
	import { sessionStore } from "$lib/stores/sessions.svelte.js";
	import Plus from "@lucide/svelte/icons/plus";
	import { cn } from "$lib/utils.js";

	function formatRelativeTime(timestamp: number): string {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);

		if (seconds < 60) return "just now";

		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;

		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;

		const months = Math.floor(days / 30);
		return `${months}mo ago`;
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" data-slot="session-list">
	<div class="px-3 py-2">
		<button
			class={cn(
				"flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
				"border border-dashed border-sidebar-border",
				"text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				"transition-colors",
			)}
		>
			<Plus class="size-4" />
			New Session
		</button>
	</div>

	<div class="flex-1 overflow-y-auto px-2 pb-2">
		{#if sessionStore.loading && sessionStore.sessions.length === 0}
			<p class="px-3 py-4 text-center text-xs text-muted-foreground">
				Loading sessions…
			</p>
		{:else if sessionStore.error}
			<p class="px-3 py-4 text-center text-xs text-destructive">
				{sessionStore.error}
			</p>
		{:else if sessionStore.filteredSessions.length === 0}
			<p class="px-3 py-4 text-center text-xs text-muted-foreground">
				No sessions yet
			</p>
		{:else}
			{#each sessionStore.filteredSessions as session (session.id)}
				{@const isSelected = session.id === sessionStore.selectedSessionId}
				<button
					class={cn(
						"flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors",
						isSelected
							? "bg-sidebar-accent text-sidebar-accent-foreground"
							: "hover:bg-sidebar-accent/50",
					)}
					onclick={() => sessionStore.selectSession(session.id)}
				>
					<span class="truncate text-sm text-sidebar-foreground">
						{session.title ?? "Untitled"}
					</span>
					<span class="text-xs text-muted-foreground">
						{formatRelativeTime(session.updatedAt)}
					</span>
				</button>
			{/each}
		{/if}
	</div>
</div>
