<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { cn } from '$lib/utils.js'
      import PlusIcon from 'phosphor-svelte/lib/PlusIcon'

      function formatRelativeTime(timestamp: number): string {
        const seconds = Math.floor((Date.now() - timestamp) / 1000)

        if (seconds < 60) return 'just now'

        const minutes = Math.floor(seconds / 60)
        if (minutes < 60) return `${minutes}m ago`

        const hours = Math.floor(minutes / 60)
        if (hours < 24) return `${hours}h ago`

        const days = Math.floor(hours / 24)
        if (days < 30) return `${days}d ago`

        const months = Math.floor(days / 30)
        return `${months}mo ago`
      }

      function sessionButtonClass(isSelected: boolean) {
        return cn(
          'flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors',
          isSelected ? 'bg-surface-hover text-foreground' : 'hover:bg-surface-hover'
        )
      }

      function isSessionSelected(sessionId: string) {
        return sessionId === sessionStore.selectedSessionId
      }

      function isSessionRunning(status: string) {
        return status === 'running'
      }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-slot="session-list">
  <div class="px-3 py-2">
    <Button
      variant={sessionStore.composing ? 'default' : 'outline'}
      size="lg"
      class="w-full"
      onclick={() => sessionStore.startComposing()}
    >
      <PlusIcon class="size-4" />
      New Session
    </Button>
  </div>

  <div class="flex-1 overflow-y-auto px-2 pb-2">
    {#if sessionStore.loading && sessionStore.sessions.length === 0}
      <p class="px-3 py-4 text-center text-xs text-muted-foreground">Loading sessions…</p>
    {:else if sessionStore.error}
      <p class="px-3 py-4 text-center text-xs text-danger">
        {sessionStore.error}
      </p>
    {:else if sessionStore.filteredSessions.length === 0}
      <p class="px-3 py-4 text-center text-xs text-muted-foreground">No sessions yet</p>
    {:else}
      {#each sessionStore.filteredSessions as session (session.id)}
        <button
          type="button"
          class={sessionButtonClass(isSessionSelected(session.id))}
          onclick={() => sessionStore.selectSession(session.id)}
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 truncate text-sm text-foreground">
              {session.title ?? 'Untitled'}
            </span>
            {#if isSessionRunning(session.status)}
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
              ></span>
            {/if}
          </div>
          <span class="text-xs text-muted-foreground">
            {formatRelativeTime(session.updatedAt)}
          </span>
        </button>
      {/each}
    {/if}
  </div>
</div>
