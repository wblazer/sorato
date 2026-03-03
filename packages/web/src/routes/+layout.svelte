<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Sidebar } from '$lib/components/sidebar/index.js';
	import { sseStore } from '$lib/stores/sse.svelte.js';
	import { sessionStore } from '$lib/stores/sessions.svelte.js';

	let { children } = $props();

	$effect(() => {
		// Global SSE — one connection for the app's lifetime.
		// Must connect before fetchSessions so that RunStart/RunEnd events
		// from any in-flight runs are captured from the start.
		sseStore.connect();
		sessionStore.fetchSessions();

		return () => {
			sseStore.disconnect();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Agents</title>
</svelte:head>

<div class="flex h-screen overflow-hidden">
	<Sidebar />
	<main class="flex-1 overflow-y-auto">
		{@render children()}
	</main>
</div>
