import { apiClient, runApiEffect } from '$lib/api-client.js'
import type { UiApiError } from '$lib/api-errors.js'
import { connectionsStore } from '$lib/stores/connections.svelte.js'
import { Effect } from 'effect'

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

  function refresh() {
    return Effect.gen(function* () {
      const connection = connectionsStore.activeConnection
      yield* Effect.sync(() => {
        connectionId = connection?.id ?? null
        version = null
        tools = []
        error = null
      })

      if (!connection) return

      yield* Effect.sync(() => {
        loading = true
      })

      const client = yield* apiClient(connection.url)
      const result = yield* runApiEffect(
        client.handshake.check(),
        'Handshake failed'
      )

      yield* Effect.sync(() => {
        if (connectionId !== connection.id) return
        version = result.version
        tools = result.tools
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          const active = connectionsStore.activeConnection
          if (active && connectionId === active.id) loading = false
        })
      )
    )
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
