<script lang="ts">
  import GlobalCommandPalette from './global-command-palette.svelte'
  import ConfirmationDialog from './confirmation-dialog.svelte'
  import ArchiveProjectDialog from './archive-project-dialog.svelte'
  import SettingsDialog from './settings-dialog.svelte'
  import ConnectProviderDialog from './connect-provider-dialog.svelte'
  import DirectoryPicker from './directory-picker.svelte'
  import SessionSearchDialog from './session/session-search-dialog.svelte'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { projectStore } from '$lib/stores/projects.svelte.js'
  import { sessionStore } from '$lib/stores/sessions.svelte.js'
  import { serverInfoStore } from '$lib/stores/server-info.svelte.js'
  import { runConnectionPromise } from '$lib/connection-runtime.js'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'

  let open = $state(false)
  let connectOpen = $state(false)
  let projectPickerOpen = $state(false)
  let archiveProjectOpen = $state(false)
  let sessionSearchOpen = $state(false)
  let settingsOpen = $state(false)

  async function handleProjectPath(path: string) {
    const project = await runConnectionPromise(
      projectStore.createLocalProject(path),
    )
    if (project) sessionStore.startNewSession(project.id)
  }

  onMount(() => {
    const unregister = [
      actionStore.register({
        id: 'provider.connect',
        title: 'Connect Provider',
        category: 'Providers',
        description: 'Store an API key for a model provider on this server.',
        keywords: ['auth', 'api key', 'model', 'provider'],
        enabled: () => !!connectionsStore.activeConnection,
        run: () => {
          connectOpen = true
        },
      }),
      actionStore.register({
        id: 'project.add',
        title: 'Add Project',
        category: 'Projects',
        description: 'Choose a local folder and add it as a project.',
        keywords: ['open', 'folder', 'directory', 'workspace'],
        enabled: () =>
          !!connectionsStore.activeConnection &&
          (authStore.hasAuthenticatedProvider || serverInfoStore.developerMode),
        run: () => {
          projectPickerOpen = true
        },
      }),
      actionStore.register({
        id: 'project.archive',
        title: 'Archive Project',
        category: 'Projects',
        description: 'Hide a project from project selectors.',
        keywords: ['remove', 'hide', 'folder', 'directory', 'workspace'],
        enabled: () => projectStore.projects.length > 0,
        run: () => {
          archiveProjectOpen = true
        },
      }),
      actionStore.register({
        id: 'session.open',
        title: 'Open Session',
        category: 'Sessions',
        description: 'Search recent sessions and open one.',
        keywords: ['resume', 'search', 'conversation'],
        defaultShortcut: 'Control+O',
        enabled: () => sessionStore.sessions.length > 0,
        run: () => {
          sessionSearchOpen = true
        },
      }),
      actionStore.register({
        id: 'session.new',
        title: 'New Session',
        category: 'Sessions',
        description: 'Show the new session composer.',
        keywords: ['chat', 'compose', 'conversation'],
        defaultShortcut: 'Control+N',
        run: () => sessionStore.startNewSession(),
      }),
      actionStore.register({
        id: 'app.command-palette',
        title: 'Open Command Palette',
        category: 'Application',
        description: 'Search and run actions from anywhere in the app.',
        keywords: ['commands', 'actions', 'launcher'],
        defaultShortcut: 'Control+P',
        palette: 'never',
        run: () => {
          open = true
        },
      }),
      actionStore.register({
        id: 'app.settings',
        title: 'Open Settings',
        category: 'Application',
        description: 'Configure client-side settings and overrides.',
        keywords: ['settings', 'preferences', 'config', 'configuration'],
        defaultShortcut: 'Control+,',
        run: () => {
          settingsOpen = true
        },
      }),
      ...(import.meta.env.DEV
        ? [
            actionStore.register({
              id: 'developer.markdown-playground',
              title: 'Open Markdown Playground',
              category: 'Developer',
              description:
                'Preview the production agent Markdown renderer with editable fixtures.',
              keywords: ['components', 'catalog', 'rendering', 'typeset'],
              run: () => {
                const url = new URL(window.location.href)
                url.searchParams.set('developer', 'markdown')
                void goto(url)
              },
            }),
            actionStore.register({
              id: 'developer.scroll-stability-playground',
              title: 'Open Scroll Stability Diagnostics',
              category: 'Developer',
              description:
                'Reproduce and measure streamed response scrolling with deterministic fixtures.',
              keywords: ['scroll', 'streaming', 'layout', 'diagnostics'],
              run: () => {
                const url = new URL(window.location.href)
                url.searchParams.set('developer', 'scroll-stability')
                void goto(url)
              },
            }),
          ]
        : []),
    ]

    return () => {
      unregister.forEach((cleanup) => {
        cleanup()
      })
    }
  })
</script>

{#if open}
  <GlobalCommandPalette bind:open />
{/if}

{#if connectOpen}
  <ConnectProviderDialog bind:open={connectOpen} />
{/if}

{#if projectPickerOpen}
  <DirectoryPicker bind:open={projectPickerOpen} onSelect={handleProjectPath} />
{/if}

{#if archiveProjectOpen}
  <ArchiveProjectDialog bind:open={archiveProjectOpen} />
{/if}

{#if sessionSearchOpen}
  <SessionSearchDialog bind:open={sessionSearchOpen} />
{/if}

{#if settingsOpen}
  <SettingsDialog bind:open={settingsOpen} />
{/if}

<ConfirmationDialog />
