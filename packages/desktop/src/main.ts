import { app, BrowserWindow, shell } from 'electron'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stopIntegratedServer } from './integrated-server.ts'
import { registerIpcHandlers } from './ipc.ts'

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const appName = isDevelopment ? 'Sorato (Dev)' : 'Sorato'

app.setName(appName)

function getPreloadPath(): string {
  return join(__dirname, 'preload.cjs')
}

function getProductionIndexHtmlPath(): string {
  return resolve(__dirname, '..', '..', 'web', 'build', 'index.html')
}

async function loadMainWindow(window: BrowserWindow): Promise<void> {
  if (isDevelopment) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL!)
    window.webContents.openDevTools({ mode: 'detach' })
    return
  }

  const indexHtmlPath = getProductionIndexHtmlPath()
  try {
    await access(indexHtmlPath)
  } catch {
    throw new Error(
      `Web build not found at ${indexHtmlPath}. Run bun run --filter @sorato/web build first.`
    )
  }
  await window.loadFile(indexHtmlPath)
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: appName,
    show: false,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(appName)
  })

  void loadMainWindow(window).catch((error: unknown) => {
    console.error('[desktop] failed to load main window', error)
  })

  return window
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  registerIpcHandlers()

  app.whenReady().then(() => {
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopIntegratedServer()
})
