// Per-provider circuit breaker.
//
// closed  -> calls allowed. N consecutive failures opens it.
// open    -> calls rejected until cooldown elapses, then -> half_open.
// half_open -> one probe allowed; success closes, failure re-opens.
//
// Deterministic and time-injectable so it is fully unit-testable.

import type { BreakerState } from '../providers/types.ts'

export interface BreakerOptions {
  failureThreshold: number
  cooldownMs: number
  /** Injectable clock (defaults to Date.now) — avoids real time in tests. */
  now?: () => number
}

export class CircuitBreaker {
  private state: BreakerState = 'closed'
  private consecutiveFailures = 0
  private openedAt = 0
  private lastError: string | null = null
  private lastLatencyMs: number | null = null
  private updatedAt = 0
  private readonly failureThreshold: number
  private readonly cooldownMs: number
  private readonly now: () => number

  constructor(opts: BreakerOptions) {
    this.failureThreshold = opts.failureThreshold
    this.cooldownMs = opts.cooldownMs
    this.now = opts.now ?? Date.now
    this.updatedAt = this.now()
  }

  /** Whether a call may proceed right now (also advances open -> half_open). */
  canRequest(): boolean {
    if (this.state === 'open') {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half_open'
        this.updatedAt = this.now()
        return true // allow a single probe
      }
      return false
    }
    return true // closed or half_open both permit a call
  }

  recordSuccess(latencyMs: number): void {
    this.consecutiveFailures = 0
    this.lastError = null
    this.lastLatencyMs = latencyMs
    this.state = 'closed'
    this.updatedAt = this.now()
  }

  recordFailure(error: string): void {
    this.consecutiveFailures += 1
    this.lastError = error
    if (
      this.state === 'half_open' ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = 'open'
      this.openedAt = this.now()
    }
    this.updatedAt = this.now()
  }

  snapshot(): {
    state: BreakerState
    available: boolean
    consecutiveFailures: number
    lastError: string | null
    lastLatencyMs: number | null
    updatedAt: number
  } {
    // `available` reflects current admissibility without mutating state.
    const available =
      this.state === 'closed' ||
      this.state === 'half_open' ||
      (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs)
    return {
      state: this.state,
      available,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastLatencyMs: this.lastLatencyMs,
      updatedAt: this.updatedAt,
    }
  }
}
