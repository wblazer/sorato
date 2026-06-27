<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { sessionLayoutStore } from '$lib/stores/session-layout.svelte.js'
  import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon'

  let {
    title,
    headerMeta,
    children,
    panel,
  }: {
    title: string
    headerMeta?: Snippet
    children: Snippet
    panel: Snippet
  } = $props()

  let sessionLayout: HTMLElement | null = $state(null)
  let treePanelElement: HTMLElement | null = $state(null)
  let treeResizeCleanup: (() => void) | null = null

  onDestroy(() => {
    treeResizeCleanup?.()
  })

  function startTreePanelResize(event: PointerEvent) {
    if (!sessionLayout || !treePanelElement) return

    event.preventDefault()
    treeResizeCleanup?.()

    const handle = event.currentTarget as HTMLElement
    const startX = event.clientX
    const startWidth = treePanelElement.getBoundingClientRect().width
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
      sessionLayout?.style.setProperty(
        '--session-tree-panel-width',
        `${currentWidth}px`,
      )
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      pendingWidth = sessionLayoutStore.clampTreePanelWidth(
        startWidth + startX - moveEvent.clientX,
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
      treeResizeCleanup = null
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      const finalWidth = Math.round(pendingWidth)
      cleanup()
      sessionLayout?.style.setProperty(
        '--session-tree-panel-width',
        `${finalWidth}px`,
      )
      sessionLayoutStore.setTreePanelWidth(finalWidth)
    }

    treeResizeCleanup = cleanup
    handle.addEventListener('pointermove', handlePointerMove)
    handle.addEventListener('pointerup', handlePointerUp)
    handle.addEventListener('pointercancel', handlePointerUp)
  }
</script>

<div
  bind:this={sessionLayout}
  class="relative flex h-full overflow-hidden"
  style={`--session-tree-panel-width: ${sessionLayoutStore.treePanelWidth}px; --session-header-height: 48px`}
>
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <div class="h-[var(--session-header-height)] border-b border-border">
      <div class="flex h-full w-full items-center gap-2 px-3 sm:px-4">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <h1
            class="truncate text-base leading-tight font-semibold text-foreground"
          >
            {title}
          </h1>
          {@render headerMeta?.()}
        </div>

        <Button
          variant="ghost"
          size="icon-lg"
          onclick={sessionLayoutStore.toggleTreePanel}
          aria-label={sessionLayoutStore.treePanelOpen
            ? 'Close side panel'
            : 'Open side panel'}
          title={sessionLayoutStore.treePanelOpen
            ? 'Close side panel'
            : 'Open side panel'}
        >
          <SidebarSimpleIcon />
        </Button>
      </div>
    </div>

    {@render children()}
  </div>

  {#if sessionLayoutStore.treePanelOpen}
    <div
      aria-hidden="true"
      class="h-full shrink-0"
      style:width="var(--session-tree-panel-width)"
    ></div>
    <div
      bind:this={treePanelElement}
      class="absolute inset-y-0 right-0 z-10 min-w-0 overflow-hidden"
      style="width: var(--session-tree-panel-width); contain: layout paint style"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation tree"
        class="group absolute inset-y-0 left-0 z-20 flex w-px cursor-col-resize items-center justify-center bg-border"
        onpointerdown={startTreePanelResize}
      >
        <div class="absolute inset-y-0 -left-1 -right-1"></div>
        <div
          class="h-8 w-1 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100"
        ></div>
      </div>
      {@render panel()}
    </div>
  {/if}
</div>
