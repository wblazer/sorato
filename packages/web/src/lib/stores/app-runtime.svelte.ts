import { authStore } from './auth.svelte.js'
import { connectionsStore, type Connection } from './connections.svelte.js'
import { projectStore } from './projects.svelte.js'
import { sessionStore } from './sessions.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { sseStore } from './sse.svelte.js'
import { tabStore } from './tabs.svelte.js'

function createAppRuntime() {
  let activatedConnectionKey = $state<string | null>(null)
  let activatingConnectionKey = $state<string | null>(null)
  let readyConnectionKey = $state<string | null>(null)
  let activationMessage = $state<string | null>(null)
  let activationError = $state<string | null>(null)

  async function prepareConnection(
    connection: Connection
  ): Promise<Connection> {
    if (connection.source !== 'integrated') return connection

    if (!window.soratoDesktop) {
      throw new Error('Local servers are only available in the desktop app.')
    }

    activationMessage = 'Starting local server…'
    const server = await window.soratoDesktop.startIntegratedServer()
    const prepared = connectionsStore.upsertIntegrated(server.url)

    return prepared
  }

  async function activateConnection(connection: Connection) {
    const key = `${connection.id}:${connection.url}`
    if (activatedConnectionKey === key || activatingConnectionKey === key)
      return

    activatingConnectionKey = key
    readyConnectionKey = null
    messagesStore.clearAll()
    activationMessage =
      connection.source === 'integrated' ? 'Starting local server…' : null
    activationError = null

    try {
      const prepared = await prepareConnection(connection)
      const preparedKey = `${prepared.id}:${prepared.url}`

      if (connectionsStore.activeConnection?.id !== prepared.id) return
      if (connectionsStore.activeConnection.url !== prepared.url) return

      activatedConnectionKey = preparedKey
      tabStore.ensureActiveConnectionTabSet()
      sseStore.disconnect()
      sseStore.connect()

      activationMessage = 'Loading workspace…'
      await authStore.load()
      if (connectionsStore.activeConnection?.id !== prepared.id) return
      if (connectionsStore.activeConnection.url !== prepared.url) return

      await Promise.all([
        projectStore.fetchProjects(),
        sessionStore.fetchSessions(),
      ])
      if (connectionsStore.activeConnection?.id !== prepared.id) return
      if (connectionsStore.activeConnection.url !== prepared.url) return

      await tabStore.loadActiveTabMessages()
      if (connectionsStore.activeConnection?.id !== prepared.id) return
      if (connectionsStore.activeConnection.url !== prepared.url) return

      readyConnectionKey = preparedKey
      activationMessage = null
    } catch (error) {
      activationError =
        error instanceof Error
          ? error.message
          : 'Failed to activate connection.'
      activationMessage = null
    } finally {
      if (activatingConnectionKey === key) activatingConnectionKey = null
    }
  }

  function deactivateConnection() {
    activatedConnectionKey = null
    activatingConnectionKey = null
    readyConnectionKey = null
    activationMessage = null
    activationError = null
    messagesStore.clearAll()
    sseStore.disconnect()
  }

  return {
    get activating() {
      return activatingConnectionKey !== null
    },
    get activationMessage() {
      return activationMessage
    },
    get activationError() {
      return activationError
    },
    get readyForActiveConnection() {
      const active = connectionsStore.activeConnection
      return !!active && readyConnectionKey === `${active.id}:${active.url}`
    },
    activateConnection,
    deactivateConnection,
  }
}

export const appRuntime = createAppRuntime()
