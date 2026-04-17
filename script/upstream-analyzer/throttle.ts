export interface RateLimiterOptions {
  requestsPerMinute: number
}

export class RateLimiter {
  private readonly minIntervalMs: number
  private nextAllowedAt = 0

  constructor(options: RateLimiterOptions) {
    if (options.requestsPerMinute <= 0) {
      throw new Error(`requestsPerMinute must be > 0, got ${options.requestsPerMinute}`)
    }
    this.minIntervalMs = Math.ceil(60_000 / options.requestsPerMinute)
  }

  async throttle(): Promise<void> {
    const now = Date.now()
    const waitMs = this.nextAllowedAt - now
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
    this.nextAllowedAt = Date.now() + this.minIntervalMs
  }
}

const limiters = new Map<string, RateLimiter>()

export function getLimiter(key: string, requestsPerMinute: number): RateLimiter {
  const existing = limiters.get(key)
  if (existing) return existing
  const created = new RateLimiter({ requestsPerMinute })
  limiters.set(key, created)
  return created
}
