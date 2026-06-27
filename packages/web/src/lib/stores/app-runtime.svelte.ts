import { authStore } from './auth.svelte.js'
import { connectionsStore } from './connections.svelte.js'
import { projectStore } from './projects.svelte.js'
import { sessionStore } from './sessions.svelte.js'
import { sseStore } from './sse.svelte.js'
import { tabStore } from './tabs.svelte.js'

function createAppRuntime() {
  let activatedConnectionKey = $state<string | null>(null)

  async function activateConnection(connection: { id: string; url: string }) {
    const key = `${connection.id}:${connection.url}`
    if (activatedConnectionKey === key) return

    activatedConnectionKey = key
    tabStore.ensureActiveConnectionTabSet()
    sseStore.disconnect()
    sseStore.connect()

    await authStore.load()
    if (connectionsStore.activeConnection?.id !== connection.id) return
    if (connectionsStore.activeConnection.url !== connection.url) return

    projectStore.fetchProjects()
    sessionStore.fetchSessions()
    tabStore.loadActiveTabMessages()
  }

  function deactivateConnection() {
    activatedConnectionKey = null
    sseStore.disconnect()
  }

  return {
    activateConnection,
    deactivateConnection,
  }
}

export const appRuntime = createAppRuntime()
