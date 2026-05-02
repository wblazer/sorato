<script lang="ts">
  /**
       * Reusable command palette shell.
       *
       * Provides the dialog chrome, search input, keyboard navigation,
       * scroll-into-view, loading state, and footer hints. Consumers
       * supply items via snippets and handle domain-specific behavior
       * (fetching, selection, extra keybindings) through props.
       */
      import * as Dialog from '$lib/components/ui/dialog/index.js'
      import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
      import { cn } from '$lib/utils.js'
      import type { Snippet } from 'svelte'
      import { untrack } from 'svelte'

      export interface KeyHint {
        key: string
        label: string
      }

      interface Props {
        /** Controls dialog visibility */
        open: boolean
        /** Two-way bound search/filter text */
        query: string
        /** Input placeholder */
        placeholder?: string
        /** Show loading spinner in the input area */
        loading?: boolean
        /** Total number of items (drives arrow key bounds) */
        itemCount: number
        /** Currently highlighted item index — bind this to track selection */
        selectedIndex: number
        /** Called when Enter is pressed on the current selection */
        onConfirm?: () => void
        /** Called for keydown events the palette doesn't handle (e.g. Tab).
         *  Return true to indicate the event was handled. */
        onKeydown?: (e: KeyboardEvent) => boolean | undefined
        /** When true, select all input text on open. When false (default),
         *  place the cursor at the end so the user can append to prefilled text. */
        selectOnOpen?: boolean
        /** Keyboard shortcut hints shown in the footer */
        hints?: KeyHint[]
        /** Overlay scope name used to suppress app-level hotkeys while open */
        hotkeyScope?: string
        /** The list content. Use the bound selectedIndex prop for highlighting. */
        items: Snippet
        /** Shown when itemCount is 0 and not loading */
        empty?: Snippet
      }

      let {
        open = $bindable(false),
        query = $bindable(''),
        placeholder = 'Search...',
        loading = false,
        itemCount,
        selectedIndex = $bindable(0),
        onConfirm,
        onKeydown,
        selectOnOpen = false,
        hints = [],
        hotkeyScope = 'command-palette',
        items,
        empty,
      }: Props = $props()

      let inputEl: HTMLInputElement | null = $state(null)
      let listEl: HTMLDivElement | null = $state(null)

      $effect(() => {
        if (!open) return
        untrack(() => hotkeyStore.pushScope(hotkeyScope))
        return () => untrack(() => hotkeyStore.popScope(hotkeyScope))
      })

      // Focus + select input when dialog opens
      $effect(() => {
        if (open) {
          queueMicrotask(() => {
            if (!inputEl) return
            inputEl.focus()
            if (selectOnOpen) {
              inputEl.select()
            } else {
              // Place cursor at end
              const len = inputEl.value.length
              inputEl.setSelectionRange(len, len)
            }
          })
        }
      })

      function scrollSelectedIntoView() {
        queueMicrotask(() => {
          const item = listEl?.querySelector("[data-selected='true']")
          item?.scrollIntoView({ block: 'nearest' })
        })
      }

      function handleKeydown(e: KeyboardEvent) {
        // Let the consumer handle first — if they claim it, stop
        if (onKeydown?.(e)) return

        switch (e.key) {
          case 'ArrowDown': {
            e.preventDefault()
            if (itemCount > 0) {
              selectedIndex = Math.min(selectedIndex + 1, itemCount - 1)
              scrollSelectedIntoView()
            }
            break
          }
          case 'ArrowUp': {
            e.preventDefault()
            if (itemCount > 0) {
              selectedIndex = Math.max(selectedIndex - 1, 0)
              scrollSelectedIntoView()
            }
            break
          }
          case 'Enter': {
            e.preventDefault()
            onConfirm?.()
            break
          }
        }
      }
</script>

<Dialog.Dialog bind:open>
  <Dialog.DialogContent
    showCloseButton={false}
    class="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
  >
    <!-- Search input -->
    <div class="flex items-center border-b px-4">
      <input
        bind:this={inputEl}
        bind:value={query}
        onkeydown={handleKeydown}
        class={cn(
          'flex h-12 w-full bg-transparent py-3 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none',
          'disabled:cursor-not-allowed '
        )}
        {placeholder}
        spellcheck="false"
        autocomplete="off"
      />
      {#if loading}
        <div
          class="size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
        ></div>
      {/if}
    </div>

    <!-- List area -->
    <div
      bind:this={listEl}
      class="max-h-72 overflow-y-auto overscroll-contain p-1"
    >
      {#if itemCount > 0}
        {@render items()}
      {:else if !loading}
        {#if empty}
          {@render empty()}
        {:else}
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">
            No results found
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer hints -->
    {#if hints.length > 0}
      <div
        class="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground"
      >
        {#each hints as hint}
          <span>
            <kbd
              class="rounded border bg-inset px-1.5 py-0.5 font-mono text-[10px]"
              >{hint.key}</kbd
            >
            {hint.label}
          </span>
        {/each}
      </div>
    {/if}
  </Dialog.DialogContent>
</Dialog.Dialog>
