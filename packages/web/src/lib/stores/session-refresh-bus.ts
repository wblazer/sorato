type SessionRefreshHandler = (sessionId: string) => void

const listeners = new Set<SessionRefreshHandler>()

export function requestSessionRefresh(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId)
  }
}

export function onSessionRefreshRequest(
  handler: SessionRefreshHandler
): () => void {
  listeners.add(handler)
  return () => listeners.delete(handler)
}
