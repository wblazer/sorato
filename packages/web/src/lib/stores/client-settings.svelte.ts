/**
 * Client settings store — browser/Electron-local UI preferences.
 *
 * These settings belong to the client, not the Sorato server. In the web app
 * they are persisted through the storage abstraction (currently localStorage).
 * A future Electron shell can provide a different storage backend without
 * changing the store's public API.
 */
import { Effect, Schema } from 'effect'
import {
  clientConfigService,
  diffClientConfig,
  mergeClientConfig,
  shouldExpandToolBlock,
  type ResolvedToolBlockExpansion,
} from '$lib/client-config/index.js'
import { getJsonWithSchema, setJsonWithSchema } from '$lib/storage.js'

export const TranscriptDisplayModeSchema = Schema.Literals(['pretty', 'raw'])
export type TranscriptDisplayMode = typeof TranscriptDisplayModeSchema.Type

export const ClientSettingsSchema = Schema.Struct({
  /**
   * pretty: render rich transcript projections and body display metadata.
   * raw: render separate model-visible transcript bodies while keeping UI headers.
   */
  transcriptDisplayMode: TranscriptDisplayModeSchema,
  toolBlockExpansion: Schema.Struct({
    default: Schema.Boolean,
    tools: Schema.Record(Schema.String, Schema.Boolean),
  }),
  expandSystemMessagesByDefault: Schema.Boolean,
})
export type ClientSettings = typeof ClientSettingsSchema.Type

const PersistedClientSettingsSchema = Schema.Struct({
  transcriptDisplayMode: Schema.optionalKey(TranscriptDisplayModeSchema),
  expandSystemMessagesByDefault: Schema.optionalKey(Schema.Boolean),
})
type PersistedClientSettings = typeof PersistedClientSettingsSchema.Type

const STORAGE_KEY = 'client-settings'

const DEFAULT_SETTINGS: ClientSettings = {
  transcriptDisplayMode: 'pretty',
  toolBlockExpansion: { default: false, tools: { Edit: true, Write: true } },
  expandSystemMessagesByDefault: false,
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

  function setTranscriptDisplayMode(mode: TranscriptDisplayMode) {
    update({ transcriptDisplayMode: mode })
  }

  function setToolBlockExpansion(expansion: ResolvedToolBlockExpansion) {
    update({ toolBlockExpansion: expansion })
  }

  function setExpandSystemMessagesByDefault(value: boolean) {
    update({ expandSystemMessagesByDefault: value })
  }

  function shouldExpandTool(toolName: string) {
    return shouldExpandToolBlock(settings.toolBlockExpansion, toolName)
  }

  async function loadFromClientConfig() {
    const config = await Effect.runPromise(clientConfigService.getResolved)
    update({
      transcriptDisplayMode: config.resolved.transcript_display_mode,
      toolBlockExpansion: config.resolved.tool_block_expansion,
      expandSystemMessagesByDefault:
        config.resolved.expand_system_messages_by_default,
    })
  }

  async function saveTranscriptDisplayMode(mode: TranscriptDisplayMode) {
    setTranscriptDisplayMode(mode)
    const config = await Effect.runPromise(clientConfigService.getResolved)
    const base = mergeClientConfig(config.defaults, config.file)
    const resolved = { ...config.resolved, transcript_display_mode: mode }
    await Effect.runPromise(
      clientConfigService.setOverrides(diffClientConfig(base, resolved))
    )
  }

  async function toggleAndSaveTranscriptDisplayMode() {
    await saveTranscriptDisplayMode(
      settings.transcriptDisplayMode === 'pretty' ? 'raw' : 'pretty'
    )
  }

  function toggleTranscriptDisplayMode() {
    setTranscriptDisplayMode(
      settings.transcriptDisplayMode === 'pretty' ? 'raw' : 'pretty'
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
    get transcriptDisplayMode() {
      return settings.transcriptDisplayMode
    },
    get toolBlockExpansion() {
      return settings.toolBlockExpansion
    },
    get prettyTranscript() {
      return settings.transcriptDisplayMode === 'pretty'
    },
    get expandSystemMessagesByDefault() {
      return settings.expandSystemMessagesByDefault
    },
    update,
    setTranscriptDisplayMode,
    setToolBlockExpansion,
    setExpandSystemMessagesByDefault,
    shouldExpandTool,
    loadFromClientConfig,
    saveTranscriptDisplayMode,
    toggleTranscriptDisplayMode,
    toggleAndSaveTranscriptDisplayMode,
    reset,
  }
}

export const clientSettingsStore = createClientSettingsStore()
