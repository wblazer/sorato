import { ToolInfo } from '@sorato/api'
import { Cause, Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { m } from 'foldkit/message'
import {
  ClientConfigSchema,
  ClientSettingsSchema,
  resolveClientConfig,
} from './client-config.ts'
import {
  createStorage,
  getJsonWithSchema,
  setJsonWithSchemaStrict,
  type StorageLike,
} from './storage.ts'
import {
  loadGroupAgentSteps,
  loadSidebarWidth,
  loadTreePanelOpen,
  loadTreePanelWidth,
  saveGroupAgentSteps,
  saveSidebarWidth,
  saveTreePanelOpen,
  saveTreePanelWidth,
} from './layout.ts'

export const HydratedBrowserState = m('HydratedBrowserState', {
  overrides: ClientConfigSchema,
  settings: ClientSettingsSchema,
  sidebarWidth: Schema.Number,
  treePanelWidth: Schema.Number,
  treePanelOpen: Schema.Boolean,
  groupAgentSteps: Schema.Boolean,
  viewportWidth: Schema.Number,
})
export const SavedSettings = m('SavedSettings', { revision: Schema.Number })
export const PersistedLayout = m('PersistedLayout')
export const CopiedSettings = m('CopiedSettings')
export const FailedSavingSettings = m('FailedSavingSettings', {
  revision: Schema.Number,
  error: Schema.String,
  rollbackOverrides: ClientConfigSchema,
  rollbackSettings: ClientSettingsSchema,
  wasReset: Schema.Boolean,
})
export const FailedCopyingSettings = m('FailedCopyingSettings', {
  error: Schema.String,
})
export const ViewportResized = m('ViewportResized', { width: Schema.Number })
export const PointerInteractionsEnded = m('PointerInteractionsEnded')

interface SaveSettingsInput {
  readonly revision: number
  readonly overrides: typeof ClientConfigSchema.Type
  readonly rollbackOverrides: typeof ClientConfigSchema.Type
  readonly rollbackSettings: typeof ClientSettingsSchema.Type
  readonly wasReset: boolean
}

export const saveSettingsToStorage = (
  backend: StorageLike | undefined,
  input: SaveSettingsInput
) =>
  Effect.sync(() => {
    setJsonWithSchemaStrict(
      backend,
      'client-config-overrides',
      ClientConfigSchema,
      input.overrides
    )
    return SavedSettings({ revision: input.revision })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed(
        FailedSavingSettings({
          revision: input.revision,
          error: Cause.pretty(cause),
          rollbackOverrides: input.rollbackOverrides,
          rollbackSettings: input.rollbackSettings,
          wasReset: input.wasReset,
        })
      )
    )
  )

const browserStorage = () =>
  createStorage(typeof localStorage === 'undefined' ? undefined : localStorage)
export const hydrateBrowserState = (
  storage = browserStorage(),
  viewportWidth?: number
) => {
  const overrides = getJsonWithSchema(
    storage,
    'client-config-overrides',
    ClientConfigSchema,
    {}
  )
  const resolved = resolveClientConfig({}, overrides)
  return {
    overrides,
    settings: {
      transcriptDisplayMode: resolved.resolved.transcript_display_mode,
      toolBlockExpansion: resolved.resolved.tool_block_expansion,
      expandSystemMessagesByDefault:
        resolved.resolved.expand_system_messages_by_default,
    },
    sidebarWidth: loadSidebarWidth(storage, viewportWidth),
    treePanelWidth: loadTreePanelWidth(storage, viewportWidth),
    treePanelOpen: loadTreePanelOpen(storage),
    groupAgentSteps: loadGroupAgentSteps(storage),
    viewportWidth: viewportWidth ?? 1440,
  }
}
export const HydrateBrowser = Command.define('HydrateBrowser', {
  messages: [HydratedBrowserState],
  execute: Effect.sync(() =>
    HydratedBrowserState(
      hydrateBrowserState(
        browserStorage(),
        typeof innerWidth === 'undefined' ? undefined : innerWidth
      )
    )
  ),
})
export const SaveSettings = Command.define('SaveSettings', {
  args: {
    revision: Schema.Number,
    overrides: ClientConfigSchema,
    settings: ClientSettingsSchema,
    rollbackOverrides: ClientConfigSchema,
    rollbackSettings: ClientSettingsSchema,
    wasReset: Schema.Boolean,
  },
  messages: [SavedSettings, FailedSavingSettings],
  execute: ({
    revision,
    overrides,
    rollbackOverrides,
    rollbackSettings,
    wasReset,
  }) =>
    saveSettingsToStorage(
      typeof localStorage === 'undefined' ? undefined : localStorage,
      {
        revision,
        overrides,
        rollbackOverrides,
        rollbackSettings,
        wasReset,
      }
    ),
})
export const SaveLayout = Command.define('SaveLayout', {
  args: {
    sidebarWidth: Schema.Number,
    treePanelWidth: Schema.Number,
    treePanelOpen: Schema.Boolean,
    groupAgentSteps: Schema.Boolean,
  },
  messages: [PersistedLayout],
  execute: (value) =>
    Effect.sync(() => {
      const storage = browserStorage()
      saveSidebarWidth(
        storage,
        value.sidebarWidth,
        typeof innerWidth === 'undefined' ? undefined : innerWidth
      )
      saveTreePanelWidth(
        storage,
        value.treePanelWidth,
        typeof innerWidth === 'undefined' ? undefined : innerWidth
      )
      saveTreePanelOpen(storage, value.treePanelOpen)
      saveGroupAgentSteps(storage, value.groupAgentSteps)
      return PersistedLayout()
    }),
})
export const CopySettings = Command.define('CopySettings', {
  args: { text: Schema.String },
  messages: [CopiedSettings, FailedCopyingSettings],
  execute: ({ text }) =>
    Effect.promise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.as(CopiedSettings()),
      Effect.catchCause((cause) =>
        Effect.succeed(FailedCopyingSettings({ error: Cause.pretty(cause) }))
      )
    ),
})
export { ToolInfo }
