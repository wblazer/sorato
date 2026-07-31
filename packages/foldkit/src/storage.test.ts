import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createStorage,
  getJsonWithSchema,
  setJsonWithSchema,
  setJsonWithSchemaStrict,
  storageKey,
  type StorageLike,
} from './storage.ts'

const memory = (): StorageLike => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    key: (index) => [...values.keys()][index] ?? null,
  }
}

describe('storage', () => {
  it('prefixes operations and clears only Sorato values', () => {
    const backend = memory()
    backend.setItem('foreign', 'keep')
    const storage = createStorage(backend)
    storage.set('one', '1')
    storage.set('two', '2')
    expect(backend.getItem('sorato:one')).toBe('1')
    expect(storage.get('one')).toBe('1')
    storage.remove('one')
    storage.clear()
    expect(backend.getItem('foreign')).toBe('keep')
    expect(storage.get('two')).toBeUndefined()
  })
  it('validates JSON and silently falls back or ignores failures', () => {
    const backend = memory()
    const storage = createStorage(backend)
    backend.setItem('sorato:value', 'false')
    expect(getJsonWithSchema(storage, 'value', Schema.String, 'fallback')).toBe(
      'fallback'
    )
    backend.setItem('sorato:value', '{')
    expect(getJsonWithSchema(storage, 'value', Schema.String, 'fallback')).toBe(
      'fallback'
    )
    setJsonWithSchema(storage, 'value', Schema.String, 'valid')
    expect(backend.getItem('sorato:value')).toBe('"valid"')
    expect(() =>
      setJsonWithSchema(storage, 'number', Schema.Finite, Number.NaN)
    ).not.toThrow()
    expect(createStorage().get('x')).toBeUndefined()
  })
  it('silences throwing adapters and composes keys', () => {
    const broken: StorageLike = {
      length: 1,
      getItem: () => {
        throw Error()
      },
      setItem: () => {
        throw Error()
      },
      removeItem: () => {
        throw Error()
      },
      key: () => {
        throw Error()
      },
    }
    const storage = createStorage(broken)
    expect(storage.get('x')).toBeUndefined()
    expect(() => {
      storage.set('x', 'x')
      storage.remove('x')
      storage.clear()
    }).not.toThrow()
    expect(storageKey('session', null, '', undefined, 'one')).toBe(
      'session:one'
    )
    expect(() =>
      setJsonWithSchemaStrict(broken, 'settings', Schema.String, 'value')
    ).toThrow()
    expect(() =>
      setJsonWithSchemaStrict(undefined, 'settings', Schema.String, 'value')
    ).toThrow('Browser storage is unavailable')
  })
})
