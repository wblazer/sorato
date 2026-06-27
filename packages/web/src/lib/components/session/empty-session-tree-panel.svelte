<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon'

  let activeTab = $state('tree')
</script>

<aside
  class="flex h-full w-full shrink-0 flex-col border-l border-border bg-background"
>
  <Tabs.Root bind:value={activeTab} class="min-h-0 flex-1 gap-0">
    <div
      class="flex h-[var(--session-header-height)] items-center border-b border-border px-3"
    >
      <Tabs.List class="w-full" variant="default">
        <Tabs.Trigger value="tree">
          <GitBranchIcon />
          Tree
        </Tabs.Trigger>
        <Tabs.Trigger value="diff">Diff</Tabs.Trigger>
      </Tabs.List>
    </div>

    <Tabs.Content value="tree" class="min-h-0 overflow-auto">
      <div class="flex h-full items-center justify-center p-6 text-center">
        <div class="max-w-xs space-y-1">
          <h3 class="text-sm font-medium text-foreground">
            No session selected
          </h3>
          <p class="text-sm text-muted-foreground">
            Choose an existing session or send a message to start one.
          </p>
        </div>
      </div>
    </Tabs.Content>

    <Tabs.Content value="diff" class="min-h-0 overflow-auto">
      <div class="flex h-full items-center justify-center p-6 text-center">
        <div class="max-w-xs space-y-1">
          <h3 class="text-sm font-medium text-foreground">
            No session selected
          </h3>
          <p class="text-sm text-muted-foreground">
            Code changes will appear here once a session is active.
          </p>
        </div>
      </div>
    </Tabs.Content>
  </Tabs.Root>
</aside>
