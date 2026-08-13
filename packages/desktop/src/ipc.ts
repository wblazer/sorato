import { dialog, ipcMain, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  loadResolvedClientConfig,
  saveClientConfigOverrides,
} from './client-config.ts'
import {
  CLIENT_CONFIG_GET_CHANNEL,
  CLIENT_CONFIG_SET_OVERRIDES_CHANNEL,
  EXTERNAL_URL_OPEN_CHANNEL,
  IMAGES_SELECT_CHANNEL,
  INTEGRATED_SERVER_START_CHANNEL,
  INTEGRATED_SERVER_STOP_CHANNEL,
} from './ipc-channels.ts'
import {
  startIntegratedServer,
  stopIntegratedServer,
} from './integrated-server.ts'

const imageMimeType = (path: string): string => {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.avif':
      return 'image/avif'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'image/png'
  }
}

const selectImages = async () => {
  const result = await dialog.showOpenDialog({
    title: 'Attach images',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'],
      },
    ],
  })

  if (result.canceled) return []

  return await Promise.all(
    result.filePaths.map(async (path) => {
      const [metadata, content] = await Promise.all([
        stat(path),
        readFile(path),
      ])
      const mediaType = imageMimeType(path)
      return {
        mediaType,
        fileName: basename(path),
        data: `data:${mediaType};base64,${content.toString('base64')}`,
        size: metadata.size,
      }
    })
  )
}

const openExternal = async (value: unknown) => {
  if (typeof value !== 'string') throw new Error('External URL is required.')
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs can be opened externally.')
  }
  await shell.openExternal(url.toString())
}

export function registerIpcHandlers() {
  ipcMain.handle(CLIENT_CONFIG_GET_CHANNEL, () => loadResolvedClientConfig())
  ipcMain.handle(CLIENT_CONFIG_SET_OVERRIDES_CHANNEL, (_event, overrides) =>
    saveClientConfigOverrides(overrides)
  )
  ipcMain.handle(INTEGRATED_SERVER_START_CHANNEL, () => startIntegratedServer())
  ipcMain.handle(INTEGRATED_SERVER_STOP_CHANNEL, () => stopIntegratedServer())
  ipcMain.handle(EXTERNAL_URL_OPEN_CHANNEL, (_event, url) => openExternal(url))
  ipcMain.handle(IMAGES_SELECT_CHANNEL, () => selectImages())
}
