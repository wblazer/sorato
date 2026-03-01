<script lang="ts">
	import { sessionStore } from '$lib/stores/sessions.svelte.js';

	const selectedSession = $derived(
		sessionStore.sessions.find((s) => s.id === sessionStore.selectedSessionId),
	);
</script>

<div class="flex flex-1 items-center justify-center p-8">
	{#if selectedSession}
		<div class="space-y-1 text-center">
			<h1 class="text-lg font-semibold text-foreground">
				{selectedSession.title ?? 'Untitled'}
			</h1>
			<p class="text-sm text-muted-foreground">
				{selectedSession.id}
			</p>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">Select a session to get started</p>
	{/if}
</div>
