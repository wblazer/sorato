<script lang="ts">
	import DirectorySelector from "./directory-selector.svelte";
	import SessionList from "./session-list.svelte";
</script>

<aside
	class="flex h-screen w-70 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
	data-slot="sidebar"
>
	<div class="p-2">
		<DirectorySelector />
	</div>
	<SessionList />
</aside>
