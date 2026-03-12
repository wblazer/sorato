/**
 * Storage abstraction layer.
 *
 * Provides a unified interface for client-side persistence.
 * Currently backed by localStorage for browser use.
 * Future: swap to electron-store when Electron arrives.
 */

const STORAGE_PREFIX = 'agents:'

export interface Storage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  clear(): void
}

function createLocalStorage(): Storage {
  return {
    get(key: string): string | null {
      if (typeof window === 'undefined') return null
      try {
        return localStorage.getItem(STORAGE_PREFIX + key)
      } catch {
        return null
      }
    },

    set(key: string, value: string): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(STORAGE_PREFIX + key, value)
      } catch {
        // Silently fail on quota exceeded
      }
    },

    remove(key: string): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.removeItem(STORAGE_PREFIX + key)
      } catch {
        // Ignore
      }
    },

    clear(): void {
      if (typeof window === 'undefined') return
      try {
        // Only clear our prefixed keys
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith(STORAGE_PREFIX)) {
            keys.push(key)
          }
        }
        keys.forEach((key) => localStorage.removeItem(key))
      } catch {
        // Ignore
      }
    },
  }
}

/** Global storage instance. Swap this for electron-store later. */
export const storage = createLocalStorage()

/** Helper for JSON values. */
export function getJson<T>(key: string, defaultValue: T): T {
  const raw = storage.get(key)
  if (!raw) return defaultValue
  try {
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

export function setJson<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value))
}
