import type { Session } from '$lib/types.js'

const API_BASE = 'http://localhost:3100'

function createSessionStore() {
  let sessions = $state<Session[]>([])
  let selectedSessionId = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  // Directories the user has explicitly opened (may not have sessions yet)
  let openedDirectories = $state<string[]>([])

  // Merge session-derived directories with explicitly opened ones
  const directories = $derived(
    [
      ...new Set([...openedDirectories, ...sessions.map((s) => s.directory)]),
    ].sort()
  )

  let selectedDirectory = $state('')

  const filteredSessions = $derived(
    sessions
      .filter((s) => s.directory === selectedDirectory)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  )

  async function fetchSessions() {
    loading = true
    error = null
    try {
      const res = await fetch(`${API_BASE}/sessions`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      sessions = await res.json()

      // Auto-select first directory if none selected
      if (!selectedDirectory && directories.length > 0) {
        selectedDirectory = directories[0] ?? ''
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to fetch sessions'
    } finally {
      loading = false
    }
  }

  return {
    get sessions() {
      return sessions
    },
    get directories() {
      return directories
    },
    get selectedDirectory() {
      return selectedDirectory
    },
    get filteredSessions() {
      return filteredSessions
    },
    get selectedSessionId() {
      return selectedSessionId
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    selectDirectory(dir: string) {
      selectedDirectory = dir
      selectedSessionId = null
    },
    /** Open a directory — adds it to the known list and selects it */
    openDirectory(dir: string) {
      if (!openedDirectories.includes(dir)) {
        openedDirectories = [...openedDirectories, dir]
      }
      selectedDirectory = dir
      selectedSessionId = null
    },
    selectSession(id: string) {
      selectedSessionId = id
    },
    fetchSessions,
  }
}

export const sessionStore = createSessionStore()
