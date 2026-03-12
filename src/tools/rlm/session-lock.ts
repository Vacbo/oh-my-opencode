export class SessionLock {
  private readonly tails = new Map<string, Promise<void>>()

  async acquire(sessionID: string): Promise<() => void> {
    const previous = this.tails.get(sessionID)
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })

    this.tails.set(sessionID, current)
    await previous

    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      if (this.tails.get(sessionID) === current) {
        this.tails.delete(sessionID)
      }
      releaseCurrent()
    }
  }
}
