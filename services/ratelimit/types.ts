// Per-IP rate limiter — provider/host-independent.
//
// Designed to sit in front of realtime-chat (or any chat/webhook endpoint):
//   incoming request -> auth/400 validation -> [RATE LIMIT GATE] -> n8n webhook
//
// It is decoupled on purpose: it does not live inside realtime-chat v66, so a
// redeploy of that function can never wipe the limiter. Drop it in as a guard.
//
// Runs unchanged under Deno (Supabase edge) and Node (Vercel) — no deps.

export interface RateLimitConfig {
  /** Rolling window length in ms (e.g. 60_000 = per minute). */
  windowMs: number
  /** Max allowed requests per key per window. */
  max: number
  /**
   * What to do if the backing store throws (DB down, timeout).
   *   'deny'  = fail-closed: reject the request (safest; can block all traffic
   *             during a store outage).
   *   'allow' = fail-open: let it through (preserves availability; drops the
   *             protection during an outage).
   * Default 'deny' per the stated fail-closed requirement — flip to 'allow' if
   * you'd rather keep chat up when the limiter's store is unavailable.
   */
  onStoreError?: 'deny' | 'allow'
  /** Prefix so multiple gates can share one store table (e.g. 'realtime-chat'). */
  keyPrefix?: string
}

export interface RateLimitResult {
  allowed: boolean
  /** Requests remaining in the current window (never negative). */
  remaining: number
  /** The configured limit (for X-RateLimit-Limit). */
  limit: number
  /** Count observed in the current window (may exceed limit when blocked). */
  count: number
  /** ms until the current window resets (for Retry-After). */
  retryAfterMs: number
  /** True when this result came from the store-error fallback path. */
  degraded: boolean
}

/**
 * Store contract: atomically increment the counter for (key, windowStart) and
 * return the new count within that window. Implementations must be atomic so
 * concurrent requests can't both slip under the limit.
 */
export interface RateLimitStore {
  increment(key: string, windowStartMs: number, windowMs: number): Promise<number>
}
