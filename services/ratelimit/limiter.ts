// Fixed-window rate limiter core. Deterministic and clock-injectable.

import type { RateLimitConfig, RateLimitResult, RateLimitStore } from './types.ts'

export class RateLimiter {
  private readonly store: RateLimitStore
  private readonly windowMs: number
  private readonly max: number
  private readonly onStoreError: 'deny' | 'allow'
  private readonly keyPrefix: string
  private readonly now: () => number

  constructor(store: RateLimitStore, config: RateLimitConfig, now: () => number = Date.now) {
    if (config.windowMs <= 0) throw new Error('windowMs must be > 0')
    if (config.max <= 0) throw new Error('max must be > 0')
    this.store = store
    this.windowMs = config.windowMs
    this.max = config.max
    this.onStoreError = config.onStoreError ?? 'deny' // fail-closed by default
    this.keyPrefix = config.keyPrefix ? `${config.keyPrefix}:` : ''
    this.now = now
  }

  /** Check + consume one unit for `clientKey` (typically the client IP). */
  async check(clientKey: string): Promise<RateLimitResult> {
    const t = this.now()
    const windowStart = Math.floor(t / this.windowMs) * this.windowMs
    const retryAfterMs = windowStart + this.windowMs - t
    const key = `${this.keyPrefix}${clientKey}`

    let count: number
    try {
      count = await this.store.increment(key, windowStart, this.windowMs)
    } catch {
      // Store unavailable: apply the configured posture, marked degraded.
      const allowed = this.onStoreError === 'allow'
      return {
        allowed,
        remaining: allowed ? this.max - 1 : 0,
        limit: this.max,
        count: allowed ? 1 : this.max + 1,
        retryAfterMs,
        degraded: true,
      }
    }

    const allowed = count <= this.max
    return {
      allowed,
      remaining: Math.max(0, this.max - count),
      limit: this.max,
      count,
      retryAfterMs,
      degraded: false,
    }
  }
}
