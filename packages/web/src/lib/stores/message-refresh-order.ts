export class MessageRefreshOrder {
  private latestCommittedRequestByTab = new Map<string, number>()
  private nextRequest = 0
  private minimumFreshRequest = 0

  begin(): number {
    const request = ++this.nextRequest
    return request
  }

  isFresh(tabId: string, request: number): boolean {
    const latestCommitted = this.latestCommittedRequestByTab.get(tabId) ?? 0
    return request >= Math.max(latestCommitted, this.minimumFreshRequest)
  }

  commitIfFresh(tabId: string, request: number, commit: () => void): boolean {
    if (!this.isFresh(tabId, request)) return false
    commit()
    this.latestCommittedRequestByTab.set(tabId, request)
    return true
  }

  clear(tabId: string): void {
    this.latestCommittedRequestByTab.set(tabId, ++this.nextRequest)
  }

  clearAll(): void {
    this.minimumFreshRequest = ++this.nextRequest
    this.latestCommittedRequestByTab.clear()
  }
}
