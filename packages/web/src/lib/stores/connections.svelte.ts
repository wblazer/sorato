/**
 * Connections store — manages server connections with persistence.
 *
 * Each connection tracks:
 * - id: unique identifier
 * - url: server URL (required)
 * - name: optional display name
 * - createdAt: when the connection was first added
 * - lastUsedAt: when the connection was last switched to (for sorting)
 *
 * The active connection drives all API calls. Switching connections
 * triggers a session refresh from the new server.
 */
import { getJson, setJson } from '$lib/storage.js'

export interface Connection {
  id: string
  url: string
  name?: string
  source?: 'remote' | 'integrated'
  createdAt: number
  lastUsedAt: number
}

const STORAGE_KEY = 'connections'
const ACTIVE_KEY = 'activeConnectionId'

function getInitialState(): {
  readonly connections: Connection[]
  readonly activeConnectionId: string | null
} {
  return {
    connections: getJson<Connection[]>(STORAGE_KEY, []),
    activeConnectionId: getJson<string | null>(ACTIVE_KEY, null),
  }
}

function createConnectionsStore() {
  // Load from storage on init
  const initialState = getInitialState()
  let connections = $state<Connection[]>(initialState.connections)
  let activeConnectionId = $state<string | null>(
    initialState.activeConnectionId
  )

  const activeConnection = $derived(
    connections.find((c) => c.id === activeConnectionId) ?? null
  )

  // ── Persistence ────────────────────────────────────────────────────

  function persist() {
    setJson(STORAGE_KEY, connections)
    setJson(ACTIVE_KEY, activeConnectionId)
  }

  // ── Public API ──────────────────────────────────────────────────────

  function add(
    connection: Omit<Connection, 'id' | 'createdAt' | 'lastUsedAt'>
  ): Connection {
    const now = Date.now()
    const newConnection: Connection = {
      ...connection,
      id: crypto.randomUUID(),
      createdAt: now,
      lastUsedAt: now,
    }
    connections = [...connections, newConnection]
    // Auto-switch to new connection if it's the first one
    if (connections.length === 1 || !activeConnectionId) {
      activeConnectionId = newConnection.id
    }
    persist()
    return newConnection
  }

  function upsertIntegrated(url: string): Connection {
    const now = Date.now()
    const existing = connections.find(
      (connection) => connection.source === 'integrated'
    )

    if (existing) {
      connections = connections.map((connection) =>
        connection.id === existing.id
          ? {
              ...connection,
              url,
              name: 'Local Server',
              source: 'integrated',
              lastUsedAt: now,
            }
          : connection
      )
      activeConnectionId = existing.id
      persist()
      return {
        ...existing,
        url,
        name: 'Local Server',
        source: 'integrated',
        lastUsedAt: now,
      }
    }

    const connection = add({
      url,
      name: 'Local Server',
      source: 'integrated',
    })
    activeConnectionId = connection.id
    persist()
    return connection
  }

  function update(
    id: string,
    updates: Partial<Pick<Connection, 'url' | 'name'>>
  ): boolean {
    const index = connections.findIndex((c) => c.id === id)
    if (index === -1) return false

    connections = connections.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    )
    persist()
    return true
  }

  function remove(id: string): boolean {
    const index = connections.findIndex((c) => c.id === id)
    if (index === -1) return false

    connections = connections.filter((c) => c.id !== id)

    // Clear active if we just removed it
    if (activeConnectionId === id) {
      activeConnectionId = connections[0]?.id ?? null
    }

    persist()
    return true
  }

  function activate(id: string): boolean {
    const connection = connections.find((c) => c.id === id)
    if (!connection) return false

    // Update lastUsedAt for the connection being activated
    connections = connections.map((c) =>
      c.id === id ? { ...c, lastUsedAt: Date.now() } : c
    )

    activeConnectionId = id
    persist()
    return true
  }

  function getApiBase(): string {
    return activeConnection?.url ?? ''
  }

  return {
    // Getters for reactive state
    get connections() {
      return connections
    },
    get activeConnection() {
      return activeConnection
    },
    get hasConnections() {
      return connections.length > 0
    },

    // Actions
    add,
    upsertIntegrated,
    update,
    remove,
    activate,
    getApiBase,
  }
}

export const connectionsStore = createConnectionsStore()
