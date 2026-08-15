<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Schema } from 'effect'
  import ConnectionManager from '../connection-manager.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js'
  import * as InputGroup from '$lib/components/ui/input-group/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import StreamingDots from '$lib/components/ui/streaming-dots.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import { appLayoutStore } from '$lib/stores/app-layout.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { runConnectionPromise } from '$lib/connection-runtime.js'
  import { getJsonWithSchema, setJsonWithSchema } from '$lib/storage.js'
  import { cn } from '$lib/utils.js'
  import type { Session } from '$lib/types.js'
  import ArrowUUpLeftIcon from 'phosphor-svelte/lib/ArrowUUpLeftIcon'
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'
  import CheckIcon from 'phosphor-svelte/lib/CheckIcon'
  import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon'
  import FolderSimpleIcon from 'phosphor-svelte/lib/FolderSimpleIcon'
  import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon'
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon'
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'

  let sidebarElement: HTMLElement | null = $state(null)
  let resizeCleanup: (() => void) | null = null
  let searchQuery = $state('')
  let projectScopeId = $state('all')
  let selectedSearchIndex = $state(0)
  let settledExpanded = $state(
    getJsonWithSchema('sidebar-settled-expanded', Schema.Boolean, true),
  )

  const scopedProject = $derived(
    projectScopeId === 'all' ? null : projectStore.getProject(projectScopeId),
  )
  const scopedSessions = $derived.by(() => {
    const projectId = projectScopeId === 'all' ? null : projectScopeId
    return sessionStore.sessions
      .filter((session) => !projectId || session.projectId === projectId)
      .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left))
  })
  const activeSessions = $derived(
    scopedSessions.filter(
      (session) => !sessionStore.settledSessionIds.has(session.id),
    ),
  )
  const settledSessions = $derived(
    scopedSessions.filter((session) =>
      sessionStore.settledSessionIds.has(session.id),
    ),
  )
  const visibleSettledSessions = $derived(
    settledExpanded
      ? settledSessions
      : settledSessions.filter(
          (session) => session.id === sessionStore.selectedSessionId,
        ),
  )
  const searchResults = $derived.by(() => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) return []

    return scopedSessions.filter((session) => {
      const project = projectStore.getProject(session.projectId)
      return `${sessionStore.displayTitle(session)} ${project?.name ?? ''}`
        .toLowerCase()
        .includes(term)
    })
  })

  $effect(() => {
    if (
      projectScopeId !== 'all' &&
      !projectStore.projects.some((project) => project.id === projectScopeId)
    ) {
      projectScopeId = 'all'
    }
  })

  onDestroy(() => {
    resizeCleanup?.()
  })

  function sessionTimestamp(session: Session): number {
    return session.lastUserMessageAt ?? session.updatedAt
  }

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    if (seconds < 60) return 'now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d`
    return `${Math.floor(days / 30)}mo`
  }

  function projectName(session: Session): string {
    return projectStore.getProject(session.projectId)?.name ?? 'Unknown project'
  }

  function openSettings() {
    actionStore.trigger('app.settings')
  }

  function openNewSession() {
    sessionStore.startNewSession(scopedProject?.id)
  }

  function openSession(sessionId: string) {
    sessionStore.selectSession(sessionId)
    searchQuery = ''
    selectedSearchIndex = 0
  }

  function settleSession(event: MouseEvent | KeyboardEvent, sessionId: string) {
    event.stopPropagation()
    sessionStore.settleSession(sessionId)
  }

  function unsettleSession(
    event: MouseEvent | KeyboardEvent,
    sessionId: string,
  ) {
    event.stopPropagation()
    sessionStore.unsettleSession(sessionId)
  }

  function toggleSettledShelf() {
    settledExpanded = !settledExpanded
    setJsonWithSchema(
      'sidebar-settled-expanded',
      Schema.Boolean,
      settledExpanded,
    )
  }

  function handleSearchInput(event: Event) {
    searchQuery = (event.currentTarget as HTMLInputElement).value
    selectedSearchIndex = 0
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      searchQuery = ''
      selectedSearchIndex = 0
      return
    }
    if (searchResults.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectedSearchIndex = (selectedSearchIndex + 1) % searchResults.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectedSearchIndex =
        (selectedSearchIndex - 1 + searchResults.length) % searchResults.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const session = searchResults[selectedSearchIndex]
      if (session) openSession(session.id)
    }

    document
      .getElementById(`sidebar-session-result-${selectedSearchIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
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
  <div
    class="relative z-20 grid shrink-0 grid-cols-[minmax(0,1fr)] gap-1 bg-background p-2 pb-1"
  >
    <Button class="w-full min-w-0 overflow-hidden" onclick={openNewSession}>
      <PencilSimpleIcon data-icon="inline-start" />
      <span class="min-w-0 truncate">New session</span>
    </Button>

    <InputGroup.Root>
      <InputGroup.Addon>
        <MagnifyingGlassIcon class="size-4 shrink-0 opacity-80" />
      </InputGroup.Addon>
      <InputGroup.Input
        type="text"
        value={searchQuery}
        oninput={handleSearchInput}
        onkeydown={handleSearchKeydown}
        placeholder="Search"
        aria-label="Search sessions"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={searchQuery.length > 0 && searchResults.length > 0}
        aria-controls={searchQuery
          ? 'sidebar-session-search-results'
          : undefined}
        aria-activedescendant={searchQuery && searchResults[selectedSearchIndex]
          ? `sidebar-session-result-${selectedSearchIndex}`
          : undefined}
      />
      {#if searchQuery}
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button
            type="button"
            size="icon-xs"
            aria-label="Clear session search"
            onclick={() => {
              searchQuery = ''
              selectedSearchIndex = 0
            }}
          >
            <XIcon class="size-3" />
          </InputGroup.Button>
        </InputGroup.Addon>
      {/if}
    </InputGroup.Root>

    <div class="flex items-center gap-1">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none hover:bg-base-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-selected data-[state=open]:text-foreground"
          aria-label="Filter sessions by project"
        >
          <FolderSimpleIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-left">
            {scopedProject?.name ?? 'All projects'}
          </span>
          <CaretDownIcon class="size-3.5 shrink-0" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="start"
          class="w-[var(--app-sidebar-width)] max-w-80"
        >
          <DropdownMenu.RadioGroup bind:value={projectScopeId}>
            <DropdownMenu.RadioItem value="all">
              <FolderSimpleIcon />
              <span class="truncate">All projects</span>
            </DropdownMenu.RadioItem>
            {#each projectStore.projects as project (project.id)}
              <DropdownMenu.RadioItem value={project.id}>
                <span class="truncate">{project.name}</span>
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-8"
              aria-label="Add project"
              onclick={() => actionStore.trigger('project.add')}
            >
              <FolderPlusIcon />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right">Add project</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>

  <ScrollArea class="min-h-0 flex-1" viewportClass="px-2 pb-2">
    {#if searchQuery}
      <ul
        id="sidebar-session-search-results"
        role="listbox"
        aria-label="Session search results"
        class="flex flex-col gap-px"
      >
        {#each searchResults as session, index (session.id)}
          <li>
            <button
              id={`sidebar-session-result-${index}`}
              type="button"
              role="option"
              tabindex="-1"
              aria-selected={index === selectedSearchIndex}
              aria-current={session.id === sessionStore.selectedSessionId
                ? 'page'
                : undefined}
              class={cn(
                'flex h-12 w-full min-w-0 cursor-default select-none items-center rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                index === selectedSearchIndex ||
                  session.id === sessionStore.selectedSessionId
                  ? 'bg-selected hover:bg-selected'
                  : 'hover:bg-base-hover',
              )}
              onclick={() => openSession(session.id)}
              onmouseenter={() => (selectedSearchIndex = index)}
            >
              <span class="min-w-0 flex-1">
                <span
                  class="block truncate text-sm font-medium text-foreground"
                >
                  {sessionStore.displayTitle(session)}
                </span>
                <span class="block truncate text-xs text-muted-foreground">
                  {projectName(session)}
                </span>
              </span>
              <span class="ml-2 shrink-0 text-xs text-muted-foreground/70">
                {formatRelativeTime(sessionTimestamp(session))}
              </span>
            </button>
          </li>
        {:else}
          <li class="px-3 py-8 text-center text-xs text-muted-foreground">
            No matching sessions
          </li>
        {/each}
      </ul>
    {:else if sessionStore.loading && sessionStore.sessions.length === 0}
      <p class="px-3 py-8 text-center text-xs text-muted-foreground">
        Loading sessions…
      </p>
    {:else if sessionStore.error}
      <div class="space-y-2 px-2 py-6 text-center">
        <p class="text-xs text-danger-muted-foreground">
          {sessionStore.error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onclick={() =>
            void runConnectionPromise(sessionStore.fetchSessions())}
        >
          Retry
        </Button>
      </div>
    {:else}
      <ul class="flex flex-col gap-1" aria-label="Active sessions">
        {#each activeSessions as session (session.id)}
          <li>
            <div
              role="button"
              tabindex="0"
              aria-label={`${sessionStore.displayTitle(session)}, ${projectName(session)}`}
              aria-current={session.id === sessionStore.selectedSessionId
                ? 'page'
                : undefined}
              class={cn(
                'group/session relative h-[3.75rem] w-full cursor-default select-none overflow-hidden rounded-md px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                session.id === sessionStore.selectedSessionId
                  ? 'bg-selected hover:bg-selected'
                  : 'hover:bg-base-hover',
              )}
              onclick={() => openSession(session.id)}
              onkeydown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault()
                  openSession(session.id)
                }
              }}
            >
              <span class="flex h-5 min-w-0 items-center gap-2">
                <span
                  class="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground"
                >
                  {projectName(session)}
                </span>
                {#if session.status === 'running'}
                  <StreamingDots
                    label="Running"
                    class="text-muted-foreground/70 transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0"
                  />
                {:else}
                  <span
                    class="shrink-0 text-xs text-muted-foreground/70 transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0"
                  >
                    {formatRelativeTime(sessionTimestamp(session))}
                  </span>
                {/if}
                <span
                  class="pointer-events-none absolute top-1.5 right-1.5 flex h-6 items-center opacity-0 transition-opacity group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100"
                >
                  <button
                    type="button"
                    aria-label="Settle session"
                    class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                    onclick={(event) => settleSession(event, session.id)}
                  >
                    <CheckIcon class="size-3.5" />
                    Settle
                  </button>
                </span>
              </span>
              <span
                class={cn(
                  'mt-1 block truncate text-sm font-medium',
                  session.id === sessionStore.selectedSessionId
                    ? 'text-foreground'
                    : 'text-foreground/90',
                )}
              >
                {sessionStore.displayTitle(session)}
              </span>
            </div>
          </li>
        {/each}
      </ul>

      {#if settledSessions.length > 0}
        <div class="mt-3">
          <button
            type="button"
            class="mb-1 flex w-full items-center gap-2 px-2.5 text-left"
            aria-expanded={settledExpanded}
            onclick={toggleSettledShelf}
          >
            <span class="text-xs font-medium text-muted-foreground/60">
              {settledExpanded
                ? 'Settled'
                : `Settled (${settledSessions.length})`}
            </span>
            <span class="h-px flex-1 bg-border/70"></span>
            <CaretDownIcon
              class={cn(
                'size-3 text-muted-foreground/60 transition-transform',
                settledExpanded && 'rotate-180',
              )}
            />
          </button>

          <ul class="flex flex-col gap-px" aria-label="Settled sessions">
            {#each visibleSettledSessions as session (session.id)}
              <li>
                <div
                  role="button"
                  tabindex="0"
                  aria-label={`${sessionStore.displayTitle(session)}, ${projectName(session)}`}
                  aria-current={session.id === sessionStore.selectedSessionId
                    ? 'page'
                    : undefined}
                  class={cn(
                    'group/settled flex h-9 w-full min-w-0 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    session.id === sessionStore.selectedSessionId
                      ? 'bg-selected text-foreground hover:bg-selected'
                      : 'text-muted-foreground hover:bg-base-hover hover:text-foreground',
                  )}
                  onclick={() => openSession(session.id)}
                  onkeydown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault()
                      openSession(session.id)
                    }
                  }}
                >
                  <span
                    class={cn(
                      'min-w-0 flex-1 truncate text-sm transition-opacity',
                      session.id === sessionStore.selectedSessionId
                        ? 'font-medium text-foreground opacity-100'
                        : 'opacity-65 group-hover/settled:opacity-100',
                    )}
                  >
                    {sessionStore.displayTitle(session)}
                  </span>
                  <span
                    class="shrink-0 text-xs text-muted-foreground/55 group-hover/settled:hidden group-focus-within/settled:hidden"
                  >
                    {formatRelativeTime(sessionTimestamp(session))}
                  </span>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <button
                          {...props}
                          type="button"
                          aria-label="Un-settle session"
                          class="hidden size-6 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground hover:text-foreground group-hover/settled:flex group-focus-within/settled:flex"
                          onclick={(event) =>
                            unsettleSession(event, session.id)}
                        >
                          <ArrowUUpLeftIcon class="size-3.5" />
                        </button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="right">
                      Un-settle session
                    </Tooltip.Content>
                  </Tooltip.Root>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if scopedSessions.length === 0}
        <p class="px-3 py-8 text-center text-xs text-muted-foreground">
          {scopedProject
            ? `No sessions in ${scopedProject.name} yet`
            : 'No sessions yet'}
        </p>
      {/if}
    {/if}
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
