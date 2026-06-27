<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import { cn } from '$lib/utils.js'
  import { Effect } from 'effect'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    const justNow = 'just now'
    if (seconds < 60) return justNow
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-slot="session-list">
  <div class="px-3 py-2">
    <Button
      variant="outline"
      size="lg"
      class="w-full"
      onclick={tabStore.openNewTab}
    >
      <PlusIcon class="size-4" />
      New Tab
    </Button>
  </div>

  <div class="no-scrollbar min-h-0 flex-1 overflow-y-auto">
    <div class="px-2 pb-2">
      {#if sessionStore.loading && sessionStore.sessions.length === 0}
        <p class="px-3 py-4 text-center text-xs text-muted-foreground">
          Loading sessions…
        </p>
      {:else if sessionStore.error}
        <div class="px-1 py-2">
          <Item.Root variant="danger" size="xs">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>Sessions failed to load</Item.Title>
              <Item.Description>{sessionStore.error}</Item.Description>
            </Item.Content>
            <Item.Actions>
              <Button
                variant="outline"
                onclick={() =>
                  void Effect.runPromise(sessionStore.fetchSessions())}
              >
                Retry
              </Button>
            </Item.Actions>
          </Item.Root>
        </div>
      {:else if sessionStore.filteredSessions.length === 0}
        <p class="px-3 py-4 text-center text-xs text-muted-foreground">
          No sessions yet
        </p>
      {:else}
        {#each sessionStore.filteredSessions as session (session.id)}
          <button
            type="button"
            class={cn(
              'flex w-full flex-col rounded-md px-3 py-2 text-left',
              session.id === tabStore.activeTab?.sessionId
                ? 'bg-selected text-foreground'
                : 'hover:bg-base-hover',
            )}
            onclick={() => sessionStore.selectSession(session.id)}
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 truncate text-sm text-foreground">
                {sessionStore.displayTitle(session)}
              </span>
              {#if session.status === 'running'}
                <span
                  class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                ></span>
              {/if}
            </div>
            <span class="text-xs text-muted-foreground"
              >{formatRelativeTime(session.updatedAt)}</span
            >
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>
