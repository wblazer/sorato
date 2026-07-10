import { startIntegratedServerConnection } from '$lib/desktop-server.js'
import {
  clearConnectionRuntime,
  installConnectionRuntime,
  runConnectionPromise,
} from '$lib/connection-runtime.js'
import { makeConnectionRuntime } from '$lib/connection-runtime-live.js'
import { authStore } from './auth.svelte.js'
import { connectionsStore, type Connection } from './connections.svelte.js'
import { projectStore } from './projects.svelte.js'
import { sessionStore } from './sessions.svelte.js'
import { messagesStore } from './messages.svelte.js'
import { sseStore } from './sse.svelte.js'
import { serverInfoStore } from './server-info.svelte.js'
import { tabStore } from './tabs.svelte.js'
import { Effect } from 'effect'

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

    activationMessage = 'Starting local server…'
    return await Effect.runPromise(startIntegratedServerConnection())
  }

  async function activateConnection(connection: Connection) {
    const key = `${connection.id}:${connection.url}`
    const originalId = connection.id
    if (activatedConnectionKey === key || activatingConnectionKey === key)
      return

    activatingConnectionKey = key
    readyConnectionKey = null
    messagesStore.clearAll()
    activationMessage =
      connection.source === 'integrated' ? 'Starting local server…' : null
    activationError = null

    let preparedKey: string | undefined
    try {
      const prepared = await prepareConnection(connection)
      preparedKey = `${prepared.id}:${prepared.url}`

      if (connectionsStore.activeConnection?.id !== prepared.id) return
      if (connectionsStore.activeConnection.url !== prepared.url) return

      installConnectionRuntime(preparedKey, makeConnectionRuntime(prepared))

      activatedConnectionKey = preparedKey
      tabStore.ensureActiveConnectionTabSet()
      sseStore.disconnect()
      sseStore.connect()
      void runConnectionPromise(serverInfoStore.refresh())

      activationMessage = 'Loading workspace…'
      await runConnectionPromise(authStore.load())
      if (
        connectionsStore.activeConnection?.id !== prepared.id ||
        connectionsStore.activeConnection.url !== prepared.url
      )
        return

      await Promise.all([
        runConnectionPromise(projectStore.fetchProjects()),
        runConnectionPromise(sessionStore.fetchSessions()),
      ])
      tabStore.reconcileSessions(sessionStore.sessions)
      if (
        connectionsStore.activeConnection?.id !== prepared.id ||
        connectionsStore.activeConnection.url !== prepared.url
      )
        return

      await runConnectionPromise(tabStore.loadActiveTabMessages())
      if (
        connectionsStore.activeConnection?.id !== prepared.id ||
        connectionsStore.activeConnection.url !== prepared.url
      )
        return

      readyConnectionKey = preparedKey
      activationMessage = null
    } catch (error) {
      if (preparedKey !== undefined) {
        if (activatedConnectionKey === preparedKey) {
          activatedConnectionKey = null
          messagesStore.clearAll()
          sseStore.disconnect()
        }
        await clearConnectionRuntime(preparedKey)
      }
      activationError =
        error instanceof Error
          ? error.message
          : 'Failed to activate connection.'
      activationMessage = null
    } finally {
      if (activatingConnectionKey === key) activatingConnectionKey = null
      if (
        connectionsStore.activeConnection?.id === originalId &&
        activatedConnectionKey !==
          `${connectionsStore.activeConnection.id}:${connectionsStore.activeConnection.url}`
      ) {
        void activateConnection(connectionsStore.activeConnection)
      }
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
    void clearConnectionRuntime()
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
