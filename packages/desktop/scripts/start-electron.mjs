import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE

const electronPath = process.env.ELECTRON_BINARY?.trim() || require('electron')

const app = spawn(electronPath, ['dist-electron/main.cjs'], {
  cwd: desktopDir,
  env: childEnv,
  stdio: 'inherit',
})

app.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
