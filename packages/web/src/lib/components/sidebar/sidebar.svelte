<script lang="ts">
  import DirectorySelector from './directory-selector.svelte'
  import SessionList from './session-list.svelte'
  import ConnectionManager from '../connection-manager.svelte'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
</script>

<aside
  class="flex h-screen w-70 shrink-0 flex-col border-r border-border bg-background"
  data-slot="sidebar"
>
  <div class="p-2">
    <DirectorySelector />
  </div>
  <SessionList />

  <!-- Connection Manager at bottom -->
  <div class="mt-auto border-t border-border">
    <ConnectionManager />
  </div>
</aside>
