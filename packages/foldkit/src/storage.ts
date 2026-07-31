import { Schema } from 'effect'

export const storagePrefix = 'sorato:'

export interface StorageLike {
  readonly length: number
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
}

export interface Storage {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
  clear(): void
}

export const createStorage = (backend?: StorageLike): Storage => ({
  get: (key) => {
    if (backend === undefined) return undefined
    try {
      return backend.getItem(storagePrefix + key) ?? undefined
    } catch {
      return undefined
    }
  },
  set: (key, value) => {
    if (backend === undefined) return
    try {
      backend.setItem(storagePrefix + key, value)
    } catch {
      // Persistence is best-effort (private mode and quota failures are normal).
    }
  },
  remove: (key) => {
    if (backend === undefined) return
    try {
      backend.removeItem(storagePrefix + key)
    } catch {
      // Persistence is best-effort.
    }
  },
  clear: () => {
    if (backend === undefined) return
    try {
      const keys: Array<string> = []
      for (let index = 0; index < backend.length; index++) {
        const key = backend.key(index)
        if (key?.startsWith(storagePrefix)) keys.push(key)
      }
      for (const key of keys) backend.removeItem(key)
    } catch {
      // Persistence is best-effort.
    }
  },
})

export const getJsonWithSchema = <T>(
  storage: Storage,
  key: string,
  schema: Schema.Codec<T, unknown, never, never>,
  fallback: T
): T => {
  const raw = storage.get(key)
  if (!raw) return fallback
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export const setJsonWithSchema = <T>(
  storage: Storage,
  key: string,
  schema: Schema.Codec<T, unknown, never, never>,
  value: T
): void => {
  try {
    storage.set(key, JSON.stringify(Schema.encodeUnknownSync(schema)(value)))
  } catch {
    // Invalid values and encoding failures must not break the client.
  }
}

export const setJsonWithSchemaStrict = <T>(
  backend: StorageLike | undefined,
  key: string,
  schema: Schema.Codec<T, unknown, never, never>,
  value: T
): void => {
  if (backend === undefined) throw new Error('Browser storage is unavailable.')
  const encoded = Schema.encodeUnknownSync(schema)(value)
  backend.setItem(storagePrefix + key, JSON.stringify(encoded))
}

export const storageKey = (
  ...parts: ReadonlyArray<string | null | undefined>
): string => parts.filter((part): part is string => !!part).join(':')
