import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

interface IntegratedServerState {
  readonly url: string
  readonly process: ChildProcessWithoutNullStreams
}

interface IntegratedServerResult {
  readonly url: string
  readonly pid: number | undefined
}

let state: IntegratedServerState | null = null

async function getAvailablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error)
      else resolveClose()
    })
  })

  if (!address || typeof address === 'string') {
    throw new Error('Could not reserve a port for the integrated server.')
  }

  return address.port
}

function getWorkspaceRoot(): string {
  return resolve(__dirname, '..', '..', '..')
}

function getServerSpawnOptions(): {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
} {
  const packagedServerBin = process.env.SORATO_SERVER_BIN?.trim()
  if (packagedServerBin) {
    return { command: packagedServerBin, args: [] }
  }

  return {
    command: 'bun',
    args: ['run', '--filter', '@sorato/server', 'start'],
    cwd: getWorkspaceRoot(),
  }
}

async function waitForHandshake(url: string): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/handshake`)
      if (response.ok) return
      lastError = new Error(`Handshake returned HTTP ${response.status}.`)
    } catch (error) {
      lastError = error
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`Integrated server did not become ready: ${message}`)
}

export async function startIntegratedServer(): Promise<IntegratedServerResult> {
  if (state && !state.process.killed) {
    await waitForHandshake(state.url)
    return { url: state.url, pid: state.process.pid }
  }

  const port = await getAvailablePort()
  const url = `http://127.0.0.1:${port}`
  const server = getServerSpawnOptions()
  const child = spawn(server.command, [...server.args], {
    cwd: server.cwd,
    env: {
      ...process.env,
      SORATO_SERVER_HOST: '127.0.0.1',
      SORATO_SERVER_PORT: String(port),
    },
    stdio: 'pipe',
  })

  state = { url, process: child }

  child.stdout.on('data', (data) => {
    console.info(`[integrated-server] ${String(data).trimEnd()}`)
  })
  child.stderr.on('data', (data) => {
    console.error(`[integrated-server] ${String(data).trimEnd()}`)
  })
  child.once('exit', () => {
    if (state?.process === child) state = null
  })

  try {
    await waitForHandshake(url)
  } catch (error) {
    child.kill()
    if (state?.process === child) state = null
    throw error
  }

  return { url, pid: child.pid }
}

export function stopIntegratedServer(): void {
  state?.process.kill()
  state = null
}
