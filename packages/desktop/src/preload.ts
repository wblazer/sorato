import { contextBridge, ipcRenderer } from 'electron'
import {
  CLIENT_CONFIG_GET_CHANNEL,
  CLIENT_CONFIG_SET_OVERRIDES_CHANNEL,
  IMAGES_SELECT_CHANNEL,
  INTEGRATED_SERVER_START_CHANNEL,
  INTEGRATED_SERVER_STOP_CHANNEL,
} from './ipc-channels.ts'

export interface SoratoDesktopBootstrap {
  readonly platform: NodeJS.Platform
}

interface ClientConfig {
  readonly expand_tool_blocks_by_default?: boolean
  readonly tool_block_expansion?: {
    readonly default?: boolean
    readonly tools?: Record<string, boolean | null>
  }
  readonly transcript_display_mode?: 'pretty' | 'raw'
  readonly expand_system_messages_by_default?: boolean
}

contextBridge.exposeInMainWorld('soratoDesktop', {
  getBootstrap: (): SoratoDesktopBootstrap => ({
    platform: process.platform,
  }),
  getClientConfig: () => ipcRenderer.invoke(CLIENT_CONFIG_GET_CHANNEL),
  setClientConfigOverrides: (overrides: ClientConfig) =>
    ipcRenderer.invoke(CLIENT_CONFIG_SET_OVERRIDES_CHANNEL, overrides),
  selectImages: () => ipcRenderer.invoke(IMAGES_SELECT_CHANNEL),
  startIntegratedServer: () =>
    ipcRenderer.invoke(INTEGRATED_SERVER_START_CHANNEL),
  stopIntegratedServer: () =>
    ipcRenderer.invoke(INTEGRATED_SERVER_STOP_CHANNEL),
})
