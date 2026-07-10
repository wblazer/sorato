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
import { Data, Effect } from 'effect'

export interface Connection {
  id: string
  url: string
  name?: string
  source?: 'remote' | 'integrated'
  createdAt: number
  lastUsedAt: number
}

type NewConnection = Omit<Connection, 'id' | 'createdAt' | 'lastUsedAt'>

export class ConnectionAlreadyExists extends Data.TaggedError(
  'ConnectionAlreadyExists'
)<{
  readonly source: 'integrated'
  readonly message: string
}> {}

const STORAGE_KEY = 'connections'
const ACTIVE_KEY = 'activeConnectionId'
const INTEGRATED_CONNECTION_SCOPE = 'local-server'

export function connectionScopeId(
  connection: Pick<Connection, 'id' | 'source'> | null | undefined
): string | undefined {
  if (!connection) return undefined
  return connection.source === 'integrated'
    ? INTEGRATED_CONNECTION_SCOPE
    : connection.id
}

function normalizeInitialState(
  storedConnections: ReadonlyArray<Connection>,
  storedActiveConnectionId: string | null
): {
  readonly connections: Connection[]
  readonly activeConnectionId: string | null
} {
  let integratedConnection: Connection | null = null
  let activeIntegratedRemoved = false
  const connections: Connection[] = []

  for (const connection of storedConnections) {
    if (connection.source !== 'integrated') {
      connections.push(connection)
      continue
    }

    if (!integratedConnection) {
      integratedConnection = {
        ...connection,
        name: 'Local Server',
        source: 'integrated',
      }
      connections.push(integratedConnection)
      continue
    }

    if (storedActiveConnectionId === connection.id)
      activeIntegratedRemoved = true
  }

  if (!storedActiveConnectionId) {
    return { connections, activeConnectionId: null }
  }

  const hasActiveConnection = connections.some(
    (connection) => connection.id === storedActiveConnectionId
  )
  const activeConnectionId = hasActiveConnection
    ? storedActiveConnectionId
    : activeIntegratedRemoved
      ? (integratedConnection?.id ?? connections[0]?.id ?? null)
      : (connections[0]?.id ?? null)

  return { connections, activeConnectionId }
}

function getInitialState(): {
  readonly connections: Connection[]
  readonly activeConnectionId: string | null
} {
  return normalizeInitialState(
    getJson<Connection[]>(STORAGE_KEY, []),
    getJson<string | null>(ACTIVE_KEY, null)
  )
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

  function add(connection: NewConnection) {
    if (
      connection.source === 'integrated' &&
      connections.some((item) => item.source === 'integrated')
    ) {
      return Effect.fail(
        new ConnectionAlreadyExists({
          source: 'integrated',
          message: 'Only one local server connection can exist.',
        })
      )
    }

    return Effect.sync(() => {
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
    })
  }

  function upsertIntegrated(url: string): Effect.Effect<Connection> {
    return Effect.sync(() => {
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

      const connection: Connection = {
        id: crypto.randomUUID(),
        url,
        name: 'Local Server',
        source: 'integrated',
        createdAt: now,
        lastUsedAt: now,
      }
      connections = [...connections, connection]
      activeConnectionId = connection.id
      persist()
      return connection
    })
  }

  function update(
    id: string,
    updates: Partial<Pick<Connection, 'url' | 'name'>>
  ): Effect.Effect<boolean> {
    return Effect.sync(() => {
      const index = connections.findIndex((c) => c.id === id)
      if (index === -1) return false

      connections = connections.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      )
      persist()
      return true
    })
  }

  function remove(id: string): Effect.Effect<boolean> {
    return Effect.sync(() => {
      const index = connections.findIndex((c) => c.id === id)
      if (index === -1) return false

      connections = connections.filter((c) => c.id !== id)

      // Clear active if we just removed it
      if (activeConnectionId === id) {
        activeConnectionId = connections[0]?.id ?? null
      }

      persist()
      return true
    })
  }

  function activate(id: string): Effect.Effect<boolean> {
    return Effect.sync(() => {
      const connection = connections.find((c) => c.id === id)
      if (!connection) return false

      // Update lastUsedAt for the connection being activated
      connections = connections.map((c) =>
        c.id === id ? { ...c, lastUsedAt: Date.now() } : c
      )

      activeConnectionId = id
      persist()
      return true
    })
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
    get activeConnectionScopeId() {
      return connectionScopeId(activeConnection)
    },

    // Actions
    add,
    upsertIntegrated,
    update,
    remove,
    activate,
  }
}

export const connectionsStore = createConnectionsStore()
