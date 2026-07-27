// Per-IP rate limiter — public entrypoint.
//
// Deno / Supabase edge usage (drop in front of the n8n webhook call):
//
//   import { RateLimiter, createPostgresStore, enforceRateLimit } from '../_shared/ratelimit/index.ts'
//   const store = createPostgresStore(async (sql, params) => {
//     const { data, error } = await admin.rpc('exec_sql', { sql, params }) // or a pg client
//     if (error) throw error
//     return data
//   })
//   const limiter = new RateLimiter(store, { windowMs: 60_000, max: 20, keyPrefix: 'realtime-chat' })
//   // ... after 400 validation:
//   const limited = await enforceRateLimit(req, limiter, corsHeaders)
//   if (limited) return limited
//   // ... proceed to the n8n webhook (v66 body preserved verbatim)
//
// Node / Vercel usage is identical with the Web Request/Response types.

export { RateLimiter } from './limiter.ts'
export {
  InMemoryStore,
  createPostgresStore,
  createRebuildRateLimitsStore,
} from './store.ts'
export type { SqlExec } from './store.ts'
export { extractClientIp, enforceRateLimit, rateLimitHeaders } from './http.ts'
export type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitStore,
} from './types.ts'
