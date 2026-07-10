import { ManagedRuntime } from 'effect'
import type { ConnectionServices } from '$lib/connection-services.js'

export type ConnectionRuntime = ManagedRuntime.ManagedRuntime<
  ConnectionServices,
  never
>

let activeRuntime: ConnectionRuntime | null = null
let activeRuntimeKey: string | null = null

export function installConnectionRuntime(
  key: string,
  runtime: ConnectionRuntime
): ConnectionRuntime {
  if (activeRuntime !== null && activeRuntimeKey === key) {
    void runtime.dispose()
    return activeRuntime
  }

  const previous = activeRuntime
  activeRuntime = runtime
  activeRuntimeKey = key
  if (previous !== null) void previous.dispose()
  return runtime
}

export async function clearConnectionRuntime(
  expectedKey?: string
): Promise<void> {
  if (expectedKey !== undefined && activeRuntimeKey !== expectedKey) return
  const previous = activeRuntime
  activeRuntime = null
  activeRuntimeKey = null
  if (previous !== null) await previous.dispose()
}

function requireActiveRuntime(): ConnectionRuntime {
  if (activeRuntime === null) {
    throw new Error('No active Sorato connection runtime')
  }
  return activeRuntime
}

export const runConnectionPromise: ConnectionRuntime['runPromise'] = (
  ...args
) => requireActiveRuntime().runPromise(...args)

export const runConnectionFork: ConnectionRuntime['runFork'] = (...args) =>
  requireActiveRuntime().runFork(...args)
