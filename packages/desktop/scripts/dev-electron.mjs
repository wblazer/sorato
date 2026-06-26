import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { waitForResources } from './wait-for-resources.mjs'

const require = createRequire(import.meta.url)
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webHost = process.env.SORATO_WEB_HOST?.trim() || '127.0.0.1'
const webPort = process.env.SORATO_WEB_PORT?.trim() || '5173'
const devServerUrl =
  process.env.VITE_DEV_SERVER_URL?.trim() || `http://${webHost}:${webPort}`

const devServer = new URL(devServerUrl)
const port = Number.parseInt(devServer.port, 10)
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(
    `VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`
  )
}

await waitForResources({
  baseDir: desktopDir,
  files: ['dist-electron/main.cjs', 'dist-electron/preload.cjs'],
  tcpHost: devServer.hostname,
  tcpPort: port,
})

const childEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
}
delete childEnv.ELECTRON_RUN_AS_NODE

const electronPath = process.env.ELECTRON_BINARY?.trim() || require('electron')

let shuttingDown = false
let currentApp = null
let restartTimer = null

function startApp() {
  if (shuttingDown || currentApp) return
  currentApp = spawn(electronPath, ['dist-electron/main.cjs'], {
    cwd: desktopDir,
    env: childEnv,
    stdio: 'inherit',
  })
  currentApp.once('exit', () => {
    currentApp = null
    if (!shuttingDown) scheduleRestart()
  })
}

function stopApp() {
  const app = currentApp
  if (!app) return Promise.resolve()
  currentApp = null
  app.kill('SIGTERM')
  return new Promise((resolveStop) => {
    app.once('exit', resolveStop)
    setTimeout(() => {
      app.kill('SIGKILL')
      resolveStop()
    }, 1500).unref()
  })
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    void stopApp().then(startApp)
  }, 120)
}

const watcher = watch(
  join(desktopDir, 'dist-electron'),
  (_eventType, filename) => {
    if (filename === 'main.cjs' || filename === 'preload.cjs') scheduleRestart()
  }
)

async function shutdown(exitCode) {
  shuttingDown = true
  watcher.close()
  if (restartTimer) clearTimeout(restartTimer)
  await stopApp()
  process.exit(exitCode)
}

startApp()
process.once('SIGINT', () => void shutdown(130))
process.once('SIGTERM', () => void shutdown(143))
