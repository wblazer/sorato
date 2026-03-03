<script lang="ts">
	import { untrack } from 'svelte';
	import { messagesStore } from '$lib/stores/messages.svelte.js';
	import { sessionStore } from '$lib/stores/sessions.svelte.js';
	import MessageBubble from './message-bubble.svelte';
	import StreamingIndicator from './streaming-indicator.svelte';
	import Composer from './composer.svelte';

	let { sessionId, title }: { sessionId: string; title: string | null } = $props();

	let messagesContainer: HTMLDivElement | undefined = $state();

	// Load messages when sessionId changes.
	// untrack prevents the effect from subscribing to reactive state
	// read inside loadMessages (e.g. sseConnection), which would cause
	// an infinite re-trigger loop.
	$effect(() => {
		if (sessionId) {
			untrack(() => messagesStore.loadMessages(sessionId));
		}
		return () => {
			messagesStore.clear();
		};
	});

	// Auto-scroll to bottom when new messages arrive or streaming parts change
	$effect(() => {
		// Touch reactive dependencies
		messagesStore.messages.length;
		messagesStore.streamingParts;

		if (messagesContainer) {
			const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
			const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
			if (isNearBottom) {
				requestAnimationFrame(() => {
					messagesContainer?.scrollTo({
						top: messagesContainer.scrollHeight,
						behavior: 'smooth',
					});
				});
			}
		}
	});

	function handleSend(input: string) {
		// Show the user's message immediately — don't wait for the server
		// round-trip. The optimistic node is replaced on the next refresh.
		messagesStore.addOptimisticUserMessage(sessionId, input);
		sessionStore.runAgent(sessionId, input);
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex items-center gap-3 border-b border-border px-6 py-3">
		<h1 class="text-sm font-semibold text-foreground">
			{title ?? 'Untitled'}
		</h1>
		<span class="text-xs text-muted-foreground">{sessionId.slice(0, 8)}</span>
		{#if messagesStore.isStreaming}
			<span class="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5">
				<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"></span>
				<span class="text-[10px] font-medium text-blue-400">live</span>
			</span>
		{/if}
	</div>

	<!-- Messages -->
	<div bind:this={messagesContainer} class="flex-1 overflow-y-auto">
		{#if messagesStore.loading}
			<div class="flex items-center justify-center p-8">
				<span class="text-sm text-muted-foreground">Loading messages...</span>
			</div>
		{:else if messagesStore.error}
			<div class="flex items-center justify-center p-8">
				<span class="text-sm text-destructive">{messagesStore.error}</span>
			</div>
		{:else if messagesStore.loaded && messagesStore.messages.length === 0 && !messagesStore.isStreaming}
			<div class="flex items-center justify-center p-8">
				<span class="text-sm text-muted-foreground">No messages yet</span>
			</div>
		{:else if messagesStore.loaded || messagesStore.isStreaming}
			<div class="flex flex-col gap-1 p-4">
				{#each messagesStore.messages as message (message.id)}
					<MessageBubble {message} />
				{/each}

				<StreamingIndicator
					parts={messagesStore.streamingParts}
					isStreaming={messagesStore.isStreaming}
				/>
			</div>
		{/if}
	</div>

	<!-- Composer -->
	<Composer
		onSend={handleSend}
		disabled={messagesStore.isStreaming}
		placeholder={messagesStore.isStreaming ? 'Agent is responding...' : 'Send a follow-up message...'}
	/>
</div>
