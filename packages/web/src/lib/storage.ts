/**
 * Storage abstraction layer.
 *
 * Provides a unified interface for client-side persistence.
 * Currently backed by localStorage for browser use.
 * Future: swap to electron-store when Electron arrives.
 */

import { Schema } from 'effect'

const STORAGE_PREFIX = 'sorato:'

export interface Storage {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
  clear(): void
}

function createLocalStorage(): Storage {
  return {
    get(key: string): string | undefined {
      if (typeof window === 'undefined') return undefined
      try {
        return localStorage.getItem(STORAGE_PREFIX + key) ?? undefined
      } catch {
        return undefined
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
        keys.forEach((key) => {
          localStorage.removeItem(key)
        })
      } catch {
        // Ignore
      }
    },
  }
}

/** Global storage instance. Swap this for electron-store later. */
export const storage = createLocalStorage()

/** Decode a persisted JSON value with an Effect Schema. */
export function getJsonWithSchema<T>(
  key: string,
  schema: Schema.Codec<T, unknown, never, never>,
  defaultValue: T
): T {
  const raw = storage.get(key)
  if (!raw) return defaultValue
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(raw))
  } catch {
    return defaultValue
  }
}

/** Encode a value with an Effect Schema before persisting it as JSON. */
export function setJsonWithSchema<T>(
  key: string,
  schema: Schema.Codec<T, unknown, never, never>,
  value: T
): void {
  try {
    storage.set(key, JSON.stringify(Schema.encodeUnknownSync(schema)(value)))
  } catch {
    // Ignore invalid/unencodable values.
  }
}

export function storageKey(...parts: ReadonlyArray<string | null | undefined>) {
  return parts.filter((part): part is string => !!part).join(':')
}
