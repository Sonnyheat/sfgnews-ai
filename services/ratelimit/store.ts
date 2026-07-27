// Rate-limit stores: in-memory (single instance / tests) and Postgres-backed
// (multi-instance, via an injected SQL executor so we stay dependency-free).

import type { RateLimitStore } from './types.ts'

/**
 * In-memory fixed-window store. Correct for a single instance and used in tests.
 * For multi-instance edge/serverless deployments use the Postgres store so the
 * count is shared across instances.
 */
export class InMemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, number>()
  private lastSweep = 0
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async increment(
    key: string,
    windowStartMs: number,
    windowMs: number,
  ): Promise<number> {
    const composite = `${key}:${windowStartMs}`
    const next = (this.buckets.get(composite) ?? 0) + 1
    this.buckets.set(composite, next)
    this.sweep(windowStartMs, windowMs)
    return next
  }

  /** Drop windows older than the current one so the map can't grow forever. */
  private sweep(windowStartMs: number, windowMs: number): void {
    const t = this.now()
    if (t - this.lastSweep < windowMs) return
    this.lastSweep = t
    for (const k of this.buckets.keys()) {
      const start = Number(k.slice(k.lastIndexOf(':') + 1))
      if (start < windowStartMs) this.buckets.delete(k)
    }
  }
}

/** Runs a parameterized SQL statement and returns rows. Inject the host's client. */
export type SqlExec = (
  sql: string,
  params: unknown[],
) => Promise<Array<Record<string, unknown>>>

/**
 * Postgres/Supabase-backed atomic fixed-window counter. Pass an `exec` that runs
 * SQL with the SERVICE ROLE (never the anon key). The upsert is atomic per row,
 * so concurrent requests increment the same window safely.
 *
 * Requires the standalone table in schema.sql (bucket_key, window_start, count).
 * If you want to reuse REBUILD's EXISTING rate_limits table instead, use
 * createRebuildRateLimitsStore below.
 */
export function createPostgresStore(exec: SqlExec): RateLimitStore {
  return {
    async increment(
      key: string,
      windowStartMs: number,
      windowMs: number,
    ): Promise<number> {
      const rows = await exec(
        `insert into public.rate_limits (bucket_key, window_start, window_ms, count)
         values ($1, to_timestamp($2 / 1000.0), $3, 1)
         on conflict (bucket_key, window_start)
         do update set count = public.rate_limits.count + 1
         returning count`,
        [key, windowStartMs, windowMs],
      )
      const count = rows?.[0]?.count
      if (typeof count !== 'number') {
        throw new Error('rate_limits: unexpected increment result')
      }
      return count
    },
  }
}

/**
 * Store backed by REBUILD's EXISTING `public.rate_limits` table
 * (columns: identifier, action, window_start, count). The limiter key arrives as
 * "<action>:<identifier>" (keyPrefix ':' clientIp), which we split so the row is
 * keyed the same way the existing table is designed for.
 *
 * REQUIRES a unique constraint on (identifier, action, window_start) for the
 * atomic upsert — see schema.sql (add_unique_rate_limits). Until that exists the
 * ON CONFLICT target is invalid, so apply that migration before wiring this in.
 */
export function createRebuildRateLimitsStore(exec: SqlExec): RateLimitStore {
  return {
    async increment(
      key: string,
      windowStartMs: number,
      _windowMs: number,
    ): Promise<number> {
      const sep = key.indexOf(':')
      const action = sep === -1 ? 'default' : key.slice(0, sep)
      const identifier = sep === -1 ? key : key.slice(sep + 1)
      const rows = await exec(
        `insert into public.rate_limits (identifier, action, window_start, count)
         values ($1, $2, to_timestamp($3 / 1000.0), 1)
         on conflict (identifier, action, window_start)
         do update set count = public.rate_limits.count + 1
         returning count`,
        [identifier, action, windowStartMs],
      )
      const count = rows?.[0]?.count
      if (typeof count !== 'number') {
        throw new Error('rate_limits: unexpected increment result')
      }
      return count
    },
  }
}
