<script lang="ts">
  import ConnectionManager from '../connection-manager.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import { cn } from '$lib/utils.js'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'

  function tabTitle(tab: (typeof tabStore.tabs)[number]) {
    if (tab.title) return tab.title
    if (tab.sessionId) {
      const session = sessionStore.sessions.find(
        (item) => item.id === tab.sessionId,
      )
      return session ? sessionStore.displayTitle(session) : 'New Session'
    }
    return 'New Tab'
  }

  function isRunning(tab: (typeof tabStore.tabs)[number]) {
    return tab.sessionId ? sessionStore.isRunning(tab.sessionId) : false
  }
</script>

<aside
  class="flex h-screen w-72 min-w-72 shrink-0 flex-col border-r border-border bg-background"
  data-slot="sidebar"
>
  <ScrollArea class="min-h-0 flex-1" viewportClass="px-2 pt-2 pb-2">
    <div class="flex flex-col gap-1">
      <div class="sticky top-0 z-20 bg-background pb-1">
        <Button
          type="button"
          variant="ghost"
          class="h-9 w-full justify-center gap-2 rounded-lg px-2 text-sm text-muted-foreground"
          onclick={tabStore.openNewTab}
        >
          <PlusIcon class="size-4" />
          <span>New Tab</span>
        </Button>
      </div>

      {#each tabStore.tabs as tab (tab.id)}
        <div
          class={cn(
            'group relative h-9 w-full rounded-lg text-sm',
            tab.id === tabStore.activeTabId
              ? 'bg-selected/80 text-foreground'
              : 'text-foreground hover:bg-base-hover/60',
          )}
        >
          <button
            type="button"
            title={tabTitle(tab)}
            class={cn(
              'hit-area-y-0.5 flex size-full min-w-0 items-center gap-2 rounded-lg px-2 text-left group-hover:pr-9',
              tab.id === tabStore.activeTabId && 'pr-9',
            )}
            onclick={() => tabStore.setActiveTab(tab.id)}
          >
            <span class="flex size-4 shrink-0 items-center justify-center">
              {#if isRunning(tab)}
                <span class="size-2 animate-pulse rounded-full bg-accent"
                ></span>
              {/if}
            </span>

            <span
              class="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"
              >{tabTitle(tab)}</span
            >
          </button>

          <button
            type="button"
            aria-label="Close tab"
            class={cn(
              'absolute top-1/2 right-1.5 z-10 size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-80 hover:text-foreground hover:opacity-100',
              tab.id === tabStore.activeTabId
                ? 'hidden hover:bg-selected group-hover:flex'
                : 'hidden hover:bg-base-hover group-hover:flex',
            )}
            onclick={(event) => {
              event.stopPropagation()
              tabStore.closeTab(tab.id)
            }}
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
      {/each}
    </div>
  </ScrollArea>

  <div class="mt-auto w-full border-t border-border p-2">
    <ConnectionManager />
  </div>
</aside>
