import { ipcMain } from 'electron'
import {
  loadResolvedClientConfig,
  saveClientConfigOverrides,
} from './client-config.ts'
import {
  CLIENT_CONFIG_GET_CHANNEL,
  CLIENT_CONFIG_SET_OVERRIDES_CHANNEL,
  INTEGRATED_SERVER_START_CHANNEL,
  INTEGRATED_SERVER_STOP_CHANNEL,
} from './ipc-channels.ts'
import {
  startIntegratedServer,
  stopIntegratedServer,
} from './integrated-server.ts'

export function registerIpcHandlers() {
  ipcMain.handle(CLIENT_CONFIG_GET_CHANNEL, () => loadResolvedClientConfig())
  ipcMain.handle(CLIENT_CONFIG_SET_OVERRIDES_CHANNEL, (_event, overrides) =>
    saveClientConfigOverrides(overrides)
  )
  ipcMain.handle(INTEGRATED_SERVER_START_CHANNEL, () => startIntegratedServer())
  ipcMain.handle(INTEGRATED_SERVER_STOP_CHANNEL, () => stopIntegratedServer())
}
