// HTTP glue: extract the client IP and turn a limiter decision into a drop-in
// gate. Works with the Web `Request`/`Response` types used by Supabase edge
// (Deno) and Vercel edge functions.

import type { RateLimiter } from './limiter.ts'
import type { RateLimitResult } from './types.ts'

/**
 * Best-effort client IP from proxy headers. Order: platform-specific first
 * (harder to spoof behind the proxy) then the left-most X-Forwarded-For hop.
 * Returns 'unknown' when nothing is present (all such callers share one bucket).
 */
export function extractClientIp(req: Request): string {
  const h = req.headers
  const direct =
    h.get('cf-connecting-ip') ||
    h.get('x-real-ip') ||
    h.get('fly-client-ip') ||
    h.get('true-client-ip')
  if (direct) return direct.trim()
  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'Retry-After': String(Math.ceil(r.retryAfterMs / 1000)),
  }
}

/**
 * The drop-in gate. Call right after the endpoint's 400/auth validation and
 * before the n8n webhook. Returns a 429 `Response` when the caller is over the
 * limit (caller should return it immediately); returns null when the request
 * may proceed. `extraHeaders` lets you merge in CORS headers.
 */
export async function enforceRateLimit(
  req: Request,
  limiter: RateLimiter,
  extraHeaders: Record<string, string> = {},
): Promise<Response | null> {
  const ip = extractClientIp(req)
  const result = await limiter.check(ip)
  if (result.allowed) return null
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      message: 'Too many requests. Please slow down and try again shortly.',
      retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000),
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...rateLimitHeaders(result),
        ...extraHeaders,
      },
    },
  )
}
