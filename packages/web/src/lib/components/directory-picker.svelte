<script lang="ts">
  import {
      CommandPalette,
      type KeyHint,
    } from '$lib/components/ui/command-palette/index.js'
    import FolderIcon from 'phosphor-svelte/lib/FolderIcon'
    import { connectionsStore } from '$lib/stores/connections.svelte.js'
    import { cn } from '$lib/utils.js'

    interface DirectoryEntry {
      name: string
      path: string
      type: 'directory' | 'file'
    }

    interface Props {
      open: boolean
      onSelect: (path: string) => void
    }

    let { open = $bindable(false), onSelect }: Props = $props()

    let query = $state('')
    let entries = $state<DirectoryEntry[]>([])
    let resolvedPath = $state('')
    let homeDir = $state('')
    let loading = $state(false)
    let error = $state<string | null>(null)
    let selectedIndex = $state(0)

    const hints: KeyHint[] = [
      { key: 'Tab', label: 'to drill in' },
      { key: 'Enter', label: 'to select' },
      { key: 'Esc', label: 'to cancel' },
    ]

    // ── Query parsing ───────────────────────────────────────────────
    //
    // Split query into the parent directory to list and an incomplete
    // tail segment to filter by.
    //
    //   ""           → parent "" (home),  tail ""
    //   "d"          → parent "" (home),  tail "d"
    //   "dev"        → parent "" (home),  tail "dev"
    //   "~/dev/"     → parent "~/dev/",   tail ""
    //   "~/dev/ag"   → parent "~/dev/",   tail "ag"
    //   "/etc/"      → parent "/etc/",    tail ""
    //   "/etc/ss"    → parent "/etc/",    tail "ss"
    //
    // Key insight: bare strings with no slash are always a filter
    // against the home directory, never a path to resolve.

    function parseQuery(raw: string): { parent: string; tail: string } {
      // ~ alone means home directory, not a filter for "~"
      if (raw === '~') return { parent: '~', tail: '' }
      const lastSlash = raw.lastIndexOf('/')
      if (lastSlash < 0) return { parent: '', tail: raw }
      return {
        parent: raw.slice(0, lastSlash + 1),
        tail: raw.slice(lastSlash + 1),
      }
    }

    // Filter entries by the incomplete tail segment (case-insensitive prefix match).
    // Clamp selectedIndex when the list shrinks so it's never out of bounds.
    const directories = $derived.by(() => {
      const { tail } = parseQuery(query)
      const dirs = entries.filter((e) => e.type === 'directory')
      return !tail
        ? dirs
        : dirs.filter((e) => e.name.toLowerCase().startsWith(tail.toLowerCase()))
    })

    // ── Fetching ────────────────────────────────────────────────────

    let requestId = 0

    async function fetchEntries(path: string) {
      const id = ++requestId
      loading = true
      error = null

      try {
        const res = await fetch(
          `${connectionsStore.getApiBase()}/directories?path=${encodeURIComponent(path)}`
        )
        if (id !== requestId) return

        if (!res.ok) {
          const body = await res.json().catch(() => null)
          error = body?.message ?? `${res.status} ${res.statusText}`
          entries = []
          return
        }

        const data = await res.json()
        if (id !== requestId) return

        resolvedPath = data.resolved
        homeDir = data.home
        entries = data.entries
        selectedIndex = 0
      } catch (e) {
        if (id !== requestId) return
        error = e instanceof Error ? e.message : 'Failed to fetch'
        entries = []
      } finally {
        if (id === requestId) loading = false
      }
    }

    // Re-fetch when the parent portion of the query changes.
    // Tail-only changes filter client-side without a server round-trip.
    let lastFetchedParent: string | null = null
    $effect(() => {
      const { parent } = parseQuery(query)
      if (parent !== lastFetchedParent) {
        lastFetchedParent = parent
        fetchEntries(parent)
      }
    })

    // ── Path display ────────────────────────────────────────────────
    //
    // Alias home dir as ~ unless the user explicitly typed an absolute
    // path (starts with /). Respect the user's notation.

    /** Whether the user is in "absolute path" mode */
    const absoluteMode = $derived(query.startsWith('/'))

    function toDisplayPath(absolutePath: string): string {
      if (absoluteMode || !homeDir) return absolutePath
      if (absolutePath === homeDir) return '~'
      if (absolutePath.startsWith(`${homeDir}/`)) {
        return `~${absolutePath.slice(homeDir.length)}`
      }
      return absolutePath
    }

    function displayPath(entry: DirectoryEntry): {
      dim: string
      bright: string
    } {
      const display = toDisplayPath(entry.path)
      const lastSlash = display.lastIndexOf('/')
      const dir = lastSlash >= 0 ? display.slice(0, lastSlash + 1) : ''
      const name = lastSlash >= 0 ? display.slice(lastSlash + 1) : display
      return { dim: dir, bright: name }
    }

    // ── Tab complete / selection ────────────────────────────────────
    //
    // Build the completed path in the user's notation — tilde when
    // they're in default/tilde mode, absolute when they typed /

    function entryAsQuery(entry: DirectoryEntry): string {
      return toDisplayPath(entry.path)
    }

    function closePicker() {
      open = false
    }

    function handlePick(path: string) {
      onSelect(path)
      closePicker()
    }

    function handleKeydown(e: KeyboardEvent): boolean | undefined {
      if (e.key === 'Tab') {
        e.preventDefault()
        const entry = directories[selectedIndex]
        if (entry) query = `${entryAsQuery(entry)}/`
        return true
      }
    }

    function handleConfirm() {
      const entry = directories[selectedIndex]
      if (entry) {
        handlePick(entry.path)
      } else if (resolvedPath && !parseQuery(query).tail) {
        // Only fall back to the listed directory when there's no
        // unmatched tail — otherwise Enter on a non-matching filter
        // would silently select the parent directory.
        handlePick(resolvedPath)
      }
    }

    function entryButtonClass(isSelected: boolean) {
      return cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
        isSelected ? 'bg-hover text-foreground' : 'text-foreground hover:bg-hover'
      )
    }

    function handleEntryMouseEnter(index: number) {
      selectedIndex = index
    }
</script>

<CommandPalette
  bind:open
  hotkeyScope="directory-picker"
  bind:query
  bind:selectedIndex
  placeholder="Type a path... (~ for home, / for root)"
  {loading}
  itemCount={directories.length}
  onConfirm={handleConfirm}
  onKeydown={handleKeydown}
  {hints}
>
  {#snippet items()}
    {#if error}
      <div class="px-3 py-6 text-center text-sm text-muted">
        {error}
      </div>
    {:else}
      {#each directories as entry, i}
        <button
          type="button"
          data-selected={i === selectedIndex}
          class={entryButtonClass(i === selectedIndex)}
          onclick={() => handlePick(entry.path)}
          onmouseenter={() => handleEntryMouseEnter(i)}
        >
          <FolderIcon class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 truncate">
            <span class="text-muted">{displayPath(entry).dim}</span><span
              class="font-medium">{displayPath(entry).bright}</span
            >
          </span>
        </button>
      {/each}
    {/if}
  {/snippet}

  {#snippet empty()}
    <div class="px-3 py-6 text-center text-sm text-muted">
      {error ?? 'No directories found'}
    </div>
  {/snippet}
</CommandPalette>
