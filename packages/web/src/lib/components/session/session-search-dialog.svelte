<script lang="ts">
  import { CommandPalette } from '$lib/components/ui/command-palette/index.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { cn } from '$lib/utils.js'

  interface Props {
    open: boolean
  }

  let { open = $bindable(false) }: Props = $props()

  let query = $state('')
  let selectedIndex = $state(0)

  const sessionOptions = $derived.by(() =>
    sessionStore.sessions
      .map((session) => {
        const project = projectStore.getProject(session.projectId)
        const title = sessionStore.displayTitle(session)

        return {
          session,
          project,
          title,
          timestamp: session.lastUserMessageAt ?? session.updatedAt,
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp),
  )

  function rankSession(
    item: (typeof sessionOptions)[number],
    term: string,
  ): number {
    if (!term) return 0

    const title = item.title.toLowerCase()
    const projectName = item.project?.name.toLowerCase() ?? ''
    const projectPath = item.project?.path.toLowerCase() ?? ''

    if (title === term) return 400
    if (title.startsWith(term)) return 300
    if (projectName.startsWith(term)) return 240
    if (title.includes(term)) return 200
    if (projectName.includes(term)) return 160
    if (projectPath.includes(term)) return 120
    return -1
  }

  const filteredSessions = $derived.by(() => {
    const term = query.trim().toLowerCase()

    return sessionOptions
      .map((item, index) => ({
        item,
        index,
        score: rankSession(item, term),
      }))
      .filter((entry) => !term || entry.score >= 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        if (a.item.timestamp !== b.item.timestamp) {
          return b.item.timestamp - a.item.timestamp
        }
        return a.index - b.index
      })
      .map((entry) => entry.item)
  })

  $effect(() => {
    if (!open) return
    query = ''
    selectedIndex = 0
  })

  $effect(() => {
    const count = filteredSessions.length
    if (count === 0) {
      selectedIndex = 0
      return
    }

    if (selectedIndex >= count) {
      selectedIndex = count - 1
    }
  })

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  function openSession(sessionId: string) {
    sessionStore.selectSession(sessionId)
    open = false
  }

  function openSelectedSession() {
    const item = filteredSessions[selectedIndex]
    if (item) openSession(item.session.id)
  }
</script>

<CommandPalette
  bind:open
  bind:query
  bind:selectedIndex
  placeholder="Search sessions..."
  itemCount={filteredSessions.length}
  loading={sessionStore.loading && sessionStore.sessions.length === 0}
  onConfirm={openSelectedSession}
  hotkeyScope="session-search"
>
  {#snippet items()}
    {#each filteredSessions as item, index (item.session.id)}
      <button
        type="button"
        data-selected={index === selectedIndex}
        class={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left outline-hidden',
          index === selectedIndex
            ? 'bg-selected text-foreground'
            : 'hover:bg-base-hover',
        )}
        onclick={() => openSession(item.session.id)}
        onmouseenter={() => (selectedIndex = index)}
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium">{item.title}</span>
          <span class="block truncate text-xs text-muted-foreground">
            {item.project?.name ?? 'Unknown project'}
          </span>
        </span>
        <span class="ml-3 shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(item.timestamp)}
        </span>
      </button>
    {/each}
  {/snippet}

  {#snippet empty()}
    <div class="px-3 py-6 text-center text-sm text-muted-foreground">
      No sessions found
    </div>
  {/snippet}
</CommandPalette>
