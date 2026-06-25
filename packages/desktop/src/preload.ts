import { contextBridge, ipcRenderer } from 'electron'
import {
  CLIENT_CONFIG_GET_CHANNEL,
  CLIENT_CONFIG_SET_OVERRIDES_CHANNEL,
} from './ipc-channels.ts'

export interface SoratoDesktopBootstrap {
  readonly serverUrl: string
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
    serverUrl: process.env.SORATO_SERVER_URL?.trim() || 'http://localhost:3100',
    platform: process.platform,
  }),
  getClientConfig: () => ipcRenderer.invoke(CLIENT_CONFIG_GET_CHANNEL),
  setClientConfigOverrides: (overrides: ClientConfig) =>
    ipcRenderer.invoke(CLIENT_CONFIG_SET_OVERRIDES_CHANNEL, overrides),
})
