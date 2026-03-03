<script lang="ts">
	import { sessionStore } from '$lib/stores/sessions.svelte.js';
	import { messagesStore } from '$lib/stores/messages.svelte.js';
	import Composer from './composer.svelte';

	let sending = $state(false);

	async function handleSend(input: string) {
		if (sending) return;
		sending = true;

		try {
			// Create the session in the current directory
			const session = await sessionStore.createSession();
			if (!session) return;

			// Pre-connect SSE and show the user's message BEFORE starting
			// the run. loadMessages connects SSE synchronously (EventSource
			// constructor), then fetches messages in the background. The
			// optimistic message gives instant feedback. When SessionView
			// mounts and calls loadMessages again, the dedup guard skips
			// the teardown — SSE stays connected, no events lost.
			messagesStore.loadMessages(session.id);
			messagesStore.addOptimisticUserMessage(session.id, input);

			// Now start the run — SSE is already listening
			await sessionStore.runAgent(session.id, input);

			// selectSession is already called by createSession,
			// so the page will transition to SessionView
		} finally {
			sending = false;
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex items-center gap-3 border-b border-border px-6 py-3">
		<h1 class="text-sm font-semibold text-foreground">New Session</h1>
		{#if sessionStore.selectedDirectory}
			<span class="text-xs text-muted-foreground">
				{sessionStore.selectedDirectory}
			</span>
		{/if}
	</div>

	<!-- Empty state / prompt -->
	<div class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
		<div class="text-center">
			<p class="text-sm text-muted-foreground">
				Start a conversation with the agent.
			</p>
			{#if !sessionStore.selectedDirectory}
				<p class="mt-2 text-xs text-destructive">
					Select a directory first.
				</p>
			{/if}
		</div>
	</div>

	<!-- Composer -->
	<Composer
		onSend={handleSend}
		disabled={sending || !sessionStore.selectedDirectory}
		placeholder={sending
			? 'Creating session...'
			: 'What would you like to do?'}
	/>
</div>
