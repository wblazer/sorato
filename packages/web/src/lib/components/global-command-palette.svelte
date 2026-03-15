<script lang="ts">
  import {
    CommandPalette,
    type KeyHint,
  } from '$lib/components/ui/command-palette/index.js'
  import {
    actionStore,
    type ActionRegistration,
  } from '$lib/stores/actions.svelte.js'
  import { cn } from '$lib/utils.js'

  interface Props {
    open: boolean
  }

  let { open = $bindable(false) }: Props = $props()

  let query = $state('')
  let selectedIndex = $state(0)

  const hints: KeyHint[] = [
    { key: '↑↓', label: 'to navigate' },
    { key: 'Enter', label: 'to run' },
    { key: 'Esc', label: 'to close' },
  ]

  function rank(action: ActionRegistration, term: string): number {
    if (!term) return 0

    const title = action.title.toLowerCase()
    const category = action.category.toLowerCase()
    const description = action.description?.toLowerCase() ?? ''
    const keywords = action.keywords?.join(' ').toLowerCase() ?? ''

    if (title === term) return 400
    if (title.startsWith(term)) return 300
    if (keywords.includes(term)) return 200
    if (title.includes(term)) return 160
    if (description.includes(term)) return 120
    if (category.includes(term)) return 80
    return -1
  }

  const filteredActions = $derived.by(() => {
    const term = query.trim().toLowerCase()

    return actionStore.paletteActions
      .map((action, index) => ({
        action,
        index,
        score: rank(action, term),
      }))
      .filter((item) => !term || item.score >= 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        return a.index - b.index
      })
      .map((item) => item.action)
  })

  $effect(() => {
    if (!open) return
    query = ''
    selectedIndex = 0
  })

  $effect(() => {
    const count = filteredActions.length
    if (count === 0) {
      selectedIndex = 0
      return
    }

    if (selectedIndex >= count) {
      selectedIndex = count - 1
    }
  })

  function runAction(action: ActionRegistration) {
    open = false
    queueMicrotask(() => {
      actionStore.trigger(action.id)
    })
  }

  function handleConfirm() {
    const action = filteredActions[selectedIndex]
    if (action) {
      runAction(action)
    }
  }
</script>

<CommandPalette
  bind:open
  bind:query
  bind:selectedIndex
  placeholder="Search actions..."
  itemCount={filteredActions.length}
  onConfirm={handleConfirm}
  {hints}
>
  {#snippet items()}
    {#each filteredActions as action, index (action.id)}
      <button
        data-selected={index === selectedIndex}
        class={cn(
          'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors',
          index === selectedIndex
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/50'
        )}
        onclick={() => runAction(action)}
        onmouseenter={() => (selectedIndex = index)}
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{action.title}</span>
            <span
              class="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
            >
              {action.category}
            </span>
          </div>
          {#if action.description}
            <div class="truncate pt-0.5 text-xs text-muted-foreground">
              {action.description}
            </div>
          {/if}
        </div>

        {#if action.defaultShortcut}
          <kbd
            class="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {action.defaultShortcut}
          </kbd>
        {/if}
      </button>
    {/each}
  {/snippet}

  {#snippet empty()}
    <div class="px-3 py-6 text-center text-sm text-muted-foreground">
      No actions found
    </div>
  {/snippet}
</CommandPalette>
