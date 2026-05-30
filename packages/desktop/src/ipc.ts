import { ipcMain } from 'electron'
import {
  loadResolvedClientConfig,
  saveClientConfigOverrides,
} from './client-config.ts'
import {
  CLIENT_CONFIG_GET_CHANNEL,
  CLIENT_CONFIG_SET_OVERRIDES_CHANNEL,
} from './ipc-channels.ts'

export function registerIpcHandlers() {
  ipcMain.handle(CLIENT_CONFIG_GET_CHANNEL, () => loadResolvedClientConfig())
  ipcMain.handle(CLIENT_CONFIG_SET_OVERRIDES_CHANNEL, (_event, overrides) =>
    saveClientConfigOverrides(overrides)
  )
}
