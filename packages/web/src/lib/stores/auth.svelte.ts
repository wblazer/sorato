import { connectionsStore } from './connections.svelte.js'

export interface AuthProviderStatus {
  id: string
  name: string
  authenticated: boolean
}

interface AuthStatusResponse {
  providers: AuthProviderStatus[]
  hasAuthenticatedProvider: boolean
}

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

  async function load() {
    const id = ++requestId
    const connectionId = connectionsStore.activeConnection?.id ?? null
    const api = connectionsStore.getApiBase()
    if (!api) {
      providers = []
      loading = false
      error = null
      loadedConnectionId = null
      return
    }

    loading = true
    loadedConnectionId = null
    error = null

    try {
      const res = await fetch(`${api}/auth`)
      if (id !== requestId) return
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data: AuthStatusResponse = await res.json()
      if (id !== requestId) return
      providers = data.providers
      loadedConnectionId = connectionId
    } catch (err) {
      if (id !== requestId) return
      providers = []
      error =
        err instanceof Error ? err.message : 'Failed to load provider auth'
      loadedConnectionId = connectionId
    } finally {
      if (id === requestId) loading = false
    }
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
