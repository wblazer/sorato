<script lang="ts">
  import GlobalCommandPalette from './global-command-palette.svelte'
      import ArchiveProjectDialog from './archive-project-dialog.svelte'
      import ConnectProviderDialog from './connect-provider-dialog.svelte'
      import DirectoryPicker from './directory-picker.svelte'
      import SessionSearchDialog from './session/session-search-dialog.svelte'
      import { actionStore } from '$lib/stores/actions.svelte.js'
      import { authStore } from '$lib/stores/auth.svelte.js'
      import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
      import { connectionsStore } from '$lib/stores/connections.svelte.js'
      import { projectStore } from '$lib/stores/projects.svelte.js'
      import { sessionStore } from '$lib/stores/sessions.svelte.js'
      import { tabStore } from '$lib/stores/tabs.svelte.js'
      import { onMount } from 'svelte'

      let open = $state(false)
      let connectOpen = $state(false)
      let projectPickerOpen = $state(false)
      let archiveProjectOpen = $state(false)
      let sessionSearchOpen = $state(false)

      async function handleProjectPath(path: string) {
        const project = await projectStore.createLocalProject(path)
        if (project && tabStore.activeTab) {
          tabStore.setDraftProject(tabStore.activeTab.id, project.id)
        }
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
              authStore.hasAuthenticatedProvider,
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
            description: 'Search recent sessions and open one in the current tab.',
            keywords: ['resume', 'search', 'conversation'],
            enabled: () => sessionStore.sessions.length > 0,
            run: () => {
              sessionSearchOpen = true
            },
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
            id: 'app.toggle-tool-output-display-mode',
            title: 'Toggle Tool Output Display Mode',
            category: 'Application',
            description: 'Switch tool results between pretty display and raw model-visible text.',
            keywords: ['tool', 'output', 'result', 'pretty', 'raw'],
            run: () => {
              clientSettingsStore.toggleToolOutputDisplayMode()
            },
          }),
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
