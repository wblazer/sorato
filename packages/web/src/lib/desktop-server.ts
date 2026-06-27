import { connectionsStore } from '$lib/stores/connections.svelte.js'

export function canStartIntegratedServer(): boolean {
  return typeof window !== 'undefined' && !!window.soratoDesktop
}

export async function startAndConnectIntegratedServer(): Promise<void> {
  if (!window.soratoDesktop) {
    throw new Error('Integrated servers are only available in the desktop app.')
  }

  const server = await window.soratoDesktop.startIntegratedServer()
  const connection = connectionsStore.upsertIntegrated(server.url)
  connectionsStore.activate(connection.id)
}

export async function stopAndRemoveIntegratedServer(): Promise<void> {
  if (!window.soratoDesktop) {
    throw new Error('Integrated servers are only available in the desktop app.')
  }

  await window.soratoDesktop.stopIntegratedServer()
  const connection = connectionsStore.connections.find(
    (candidate) => candidate.source === 'integrated'
  )
  if (connection) connectionsStore.remove(connection.id)
}
