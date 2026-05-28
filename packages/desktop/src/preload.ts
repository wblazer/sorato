import { contextBridge } from 'electron'

export interface SoratoDesktopBootstrap {
  readonly serverUrl: string
  readonly platform: NodeJS.Platform
}

contextBridge.exposeInMainWorld('soratoDesktop', {
  getBootstrap: (): SoratoDesktopBootstrap => ({
    serverUrl: process.env.SORATO_SERVER_URL?.trim() || 'http://localhost:3100',
    platform: process.platform,
  }),
})
