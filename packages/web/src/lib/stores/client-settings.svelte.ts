/**
 * Client settings store — browser/Electron-local UI preferences.
 *
 * These settings belong to the client, not the Sorato server. In the web app
 * they are persisted through the storage abstraction (currently localStorage).
 * A future Electron shell can provide a different storage backend without
 * changing the store's public API.
 */
import { Schema } from 'effect'
import { getJsonWithSchema, setJsonWithSchema } from '$lib/storage.js'

export const ToolOutputDisplayModeSchema = Schema.Literals(['pretty', 'raw'])
export type ToolOutputDisplayMode = typeof ToolOutputDisplayModeSchema.Type

export const ClientSettingsSchema = Schema.Struct({
  /**
   * pretty: render structured tool display payloads when available.
   * raw: render the exact tool result text that is fed back to the model.
   */
  toolOutputDisplayMode: ToolOutputDisplayModeSchema,
})
export type ClientSettings = typeof ClientSettingsSchema.Type

const PersistedClientSettingsSchema = Schema.Struct({
  toolOutputDisplayMode: Schema.optionalKey(ToolOutputDisplayModeSchema),
})
type PersistedClientSettings = typeof PersistedClientSettingsSchema.Type

const STORAGE_KEY = 'client-settings'

const DEFAULT_SETTINGS: ClientSettings = {
  toolOutputDisplayMode: 'pretty',
}

function loadSettings(): ClientSettings {
  const persisted = getJsonWithSchema<PersistedClientSettings>(
    STORAGE_KEY,
    PersistedClientSettingsSchema,
    {}
  )
  return { ...DEFAULT_SETTINGS, ...persisted }
}

function createClientSettingsStore() {
  let settings = $state<ClientSettings>(loadSettings())

  function persist() {
    setJsonWithSchema(STORAGE_KEY, ClientSettingsSchema, settings)
  }

  function update(updates: Partial<ClientSettings>) {
    settings = { ...settings, ...updates }
    persist()
  }

  function setToolOutputDisplayMode(mode: ToolOutputDisplayMode) {
    update({ toolOutputDisplayMode: mode })
  }

  function toggleToolOutputDisplayMode() {
    setToolOutputDisplayMode(
      settings.toolOutputDisplayMode === 'pretty' ? 'raw' : 'pretty'
    )
  }

  function reset() {
    settings = DEFAULT_SETTINGS
    persist()
  }

  return {
    get settings() {
      return settings
    },
    get toolOutputDisplayMode() {
      return settings.toolOutputDisplayMode
    },
    get prettyToolOutput() {
      return settings.toolOutputDisplayMode === 'pretty'
    },
    update,
    setToolOutputDisplayMode,
    toggleToolOutputDisplayMode,
    reset,
  }
}

export const clientSettingsStore = createClientSettingsStore()
