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

interface CachedLimiter {
  limiter: RateLimiter
  requestsPerMinute: number
}

const limiters = new Map<string, CachedLimiter>()

export function getLimiter(key: string, requestsPerMinute: number): RateLimiter {
  const existing = limiters.get(key)
  if (existing) {
    // Guard against silently returning a limiter configured with a different
    // rate. Today all call sites use fixed per-provider rates, but if that
    // ever changes we want a loud failure rather than mysterious throttling.
    if (existing.requestsPerMinute !== requestsPerMinute) {
      throw new Error(
        `RateLimiter cache mismatch for ${key}: cached ${existing.requestsPerMinute} rpm, requested ${requestsPerMinute} rpm`,
      )
    }
    return existing.limiter
  }
  const limiter = new RateLimiter({ requestsPerMinute })
  limiters.set(key, { limiter, requestsPerMinute })
  return limiter
}
