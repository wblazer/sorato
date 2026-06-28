<script lang="ts">
  import { onDestroy } from 'svelte'
  import ConnectionManager from '../connection-manager.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import { appLayoutStore } from '$lib/stores/app-layout.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { tabStore } from '$lib/stores/tabs.svelte.js'
  import { cn } from '$lib/utils.js'
  import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'

  let sidebarElement: HTMLElement | null = $state(null)
  let resizeCleanup: (() => void) | null = null

  onDestroy(() => {
    resizeCleanup?.()
  })

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

  function openSettings() {
    actionStore.trigger('app.settings')
  }

  function startSidebarResize(event: PointerEvent) {
    if (!sidebarElement) return

    event.preventDefault()
    resizeCleanup?.()

    const handle = event.currentTarget as HTMLElement
    const startX = event.clientX
    const startWidth = sidebarElement.getBoundingClientRect().width
    let currentWidth = startWidth
    let pendingWidth = startWidth
    let frame = 0
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    handle.setPointerCapture(event.pointerId)

    const applyWidth = () => {
      frame = 0
      currentWidth = pendingWidth
      sidebarElement?.style.setProperty(
        '--app-sidebar-width',
        `${currentWidth}px`,
      )
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      pendingWidth = appLayoutStore.clampSidebarWidth(
        startWidth + moveEvent.clientX - startX,
      )
      if (frame === 0) frame = requestAnimationFrame(applyWidth)
    }

    const cleanup = () => {
      handle.removeEventListener('pointermove', handlePointerMove)
      handle.removeEventListener('pointerup', handlePointerUp)
      handle.removeEventListener('pointercancel', handlePointerUp)
      if (frame !== 0) cancelAnimationFrame(frame)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId)
      }
      resizeCleanup = null
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      const finalWidth = Math.round(pendingWidth)
      cleanup()
      sidebarElement?.style.setProperty(
        '--app-sidebar-width',
        `${finalWidth}px`,
      )
      appLayoutStore.setSidebarWidth(finalWidth)
    }

    resizeCleanup = cleanup
    handle.addEventListener('pointermove', handlePointerMove)
    handle.addEventListener('pointerup', handlePointerUp)
    handle.addEventListener('pointercancel', handlePointerUp)
  }
</script>

<aside
  bind:this={sidebarElement}
  class="relative flex h-screen min-w-0 shrink-0 flex-col border-r border-border bg-background"
  data-slot="sidebar"
  style={`--app-sidebar-width: ${appLayoutStore.sidebarWidth}px; width: var(--app-sidebar-width)`}
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

  <div class="mt-auto grid w-full gap-1 border-t border-border p-2">
    <ConnectionManager />
    <Button
      type="button"
      variant="ghost"
      class="w-full justify-start text-muted-foreground hover:text-foreground"
      onclick={openSettings}
    >
      <GearSixIcon class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate text-left">Settings</span>
    </Button>
  </div>

  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    class="group absolute inset-y-0 right-0 z-30 flex w-px cursor-col-resize items-center justify-center"
    onpointerdown={startSidebarResize}
  >
    <div class="absolute inset-y-0 -left-1 -right-1"></div>
    <div
      class="h-8 w-1 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100"
    ></div>
  </div>
</aside>
