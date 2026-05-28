import * as FileSystem from 'node:fs/promises'
import * as Net from 'node:net'
import * as Path from 'node:path'
import * as Timers from 'node:timers/promises'

async function fileExists(filePath) {
  try {
    await FileSystem.access(filePath)
    return true
  } catch {
    return false
  }
}

function tcpPortIsReady({ host, port, connectTimeoutMs = 500 }) {
  return new Promise((resolveReady) => {
    const socket = Net.createConnection({ host, port })
    let settled = false
    const finish = (ready) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolveReady(ready)
    }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.setTimeout(connectTimeoutMs)
  })
}

export async function waitForResources({
  baseDir,
  files = [],
  intervalMs = 100,
  timeoutMs = 120_000,
  tcpHost = '127.0.0.1',
  tcpPort,
}) {
  const startedAt = Date.now()
  while (true) {
    const pendingFiles = []
    for (const relativeFilePath of files) {
      if (!(await fileExists(Path.resolve(baseDir, relativeFilePath)))) {
        pendingFiles.push(relativeFilePath)
      }
    }
    const tcpReady = await tcpPortIsReady({ host: tcpHost, port: tcpPort })
    if (pendingFiles.length === 0 && tcpReady) return
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for desktop dev resources: ${[
          tcpReady ? undefined : `tcp:${tcpHost}:${tcpPort}`,
          ...pendingFiles.map((filePath) => `file:${filePath}`),
        ]
          .filter(Boolean)
          .join(', ')}`
      )
    }
    await Timers.setTimeout(intervalMs)
  }
}
