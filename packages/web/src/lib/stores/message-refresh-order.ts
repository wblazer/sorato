export class MessageRefreshOrder {
  private latestCommittedRequest = 0
  private nextRequest = 0

  begin(): number {
    const request = ++this.nextRequest
    return request
  }

  isFresh(request: number): boolean {
    return request >= this.latestCommittedRequest
  }

  commitIfFresh(request: number, commit: () => void): boolean {
    if (!this.isFresh(request)) return false
    commit()
    this.latestCommittedRequest = request
    return true
  }

  clear(): void {
    this.latestCommittedRequest = ++this.nextRequest
  }

  clearAll(): void {
    this.clear()
  }
}
