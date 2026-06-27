import { apiClient, runApiEffect } from '$lib/api-client.js'
import type { UiApiError } from '$lib/api-errors.js'
import type { AuthProviderStatus } from '@sorato/api'
import { Effect } from 'effect'
import { connectionsStore } from './connections.svelte.js'

function createAuthStore() {
  let providers = $state<AuthProviderStatus[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let loadedConnectionId = $state<string | null>(null)
  let requestId = 0

  const loadedForActiveConnection = $derived(
    !!connectionsStore.activeConnection &&
      loadedConnectionId === connectionsStore.activeConnection.id
  )

  function load() {
    return Effect.gen(function* () {
      const id = ++requestId
      const connectionId = connectionsStore.activeConnection?.id ?? null
      const api = connectionsStore.getApiBase()
      if (!api) {
        yield* Effect.sync(() => {
          providers = []
          loading = false
          error = null
          loadedConnectionId = null
        })
        return
      }

      yield* Effect.sync(() => {
        loading = true
        loadedConnectionId = null
        error = null
      })

      const client = yield* apiClient(api)
      const result = yield* runApiEffect(
        client.auth.status(),
        'Failed to check provider credentials'
      )

      yield* Effect.sync(() => {
        if (id !== requestId) return
        providers = [...result.providers]
        loadedConnectionId = connectionId
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          providers = []
          error = cause.message
          loadedConnectionId = connectionsStore.activeConnection?.id ?? null
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          loading = false
        })
      )
    )
  }

  return {
    get providers() {
      return providers
    },
    get loading() {
      return loading
    },
    get loadedForActiveConnection() {
      return loadedForActiveConnection
    },
    get error() {
      return error
    },
    get hasAuthenticatedProvider() {
      return providers.some((provider) => provider.authenticated)
    },
    load,
  }
}

export const authStore = createAuthStore()
