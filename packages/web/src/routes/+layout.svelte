<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Sidebar } from '$lib/components/sidebar/index.js';
	import { sessionStore } from '$lib/stores/sessions.svelte.js';

	let { children } = $props();

	$effect(() => {
		sessionStore.fetchSessions();
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
