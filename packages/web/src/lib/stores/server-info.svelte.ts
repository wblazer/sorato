import { getApiClient, runApi } from '$lib/api-client.js'
import { connectionsStore } from '$lib/stores/connections.svelte.js'

export interface ServerToolInfo {
  readonly name: string
  readonly displayName: string
}

function createServerInfoStore() {
  let connectionId = $state<string | null>(null)
  let version = $state<string | null>(null)
  let tools = $state<ReadonlyArray<ServerToolInfo>>([])
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function refresh() {
    const connection = connectionsStore.activeConnection
    connectionId = connection?.id ?? null
    version = null
    tools = []
    error = null

    if (!connection) return

    loading = true
    try {
      const client = await getApiClient(connection.url)
      const result = await runApi(client.handshake.check(), 'Handshake failed')
      if (connectionId !== connection.id) return

      if (result.ok) {
        version = result.value.version
        tools = result.value.tools
      } else {
        error = result.error.message
      }
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : 'Failed to load server info.'
    } finally {
      if (connectionId === connection.id) loading = false
    }
  }

  return {
    get version() {
      return version
    },
    get tools() {
      return tools
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    refresh,
  }
}

export const serverInfoStore = createServerInfoStore()
