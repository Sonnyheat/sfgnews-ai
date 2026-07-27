# Per-IP rate limiter (decoupled gate for realtime-chat)

A small, dependency-free per-IP rate limiter that drops in front of
`realtime-chat` (or any chat/webhook endpoint) **without editing that function**.

> Status: staged, tested, **not deployed**. Built decoupled on purpose so a
> redeploy of `realtime-chat` v66 can't wipe the limiter — no overwrite, no race.

## Where it goes in the request path

```
incoming request
  → auth / 400 validation        (v66, unchanged)
  → [ RATE LIMIT GATE ]          (this module)  ← per-IP, fail-closed
  → n8n webhook call             (v66, unchanged)
  → single response to user
```

## Usage (Supabase edge / Deno — same for Vercel with Web Request/Response)

```ts
import { RateLimiter, createPostgresStore, enforceRateLimit } from './ratelimit/index.ts'

// Service-role SQL executor (NEVER the anon key):
const store = createPostgresStore(async (sql, params) => {
  const { data, error } = await admin.rpc('exec_sql', { sql, params }) // or a pg client
  if (error) throw error
  return data
})

const limiter = new RateLimiter(store, {
  windowMs: 60_000,           // per minute
  max: 20,                    // 20 msgs/min/IP (tune to taste)
  keyPrefix: 'realtime-chat',
  onStoreError: 'deny',       // fail-closed (default)
})

// inside the handler, AFTER the existing 400/auth validation:
const limited = await enforceRateLimit(req, limiter, corsHeaders)
if (limited) return limited   // 429 + Retry-After, v66 body never touched

// ... proceed to the n8n webhook exactly as v66 does today
```

## Design choices

- **Fixed-window counter**, atomic in the DB (`ON CONFLICT ... count + 1`), so
  concurrent requests can't both slip under the limit.
- **Per-IP** via `cf-connecting-ip` / `x-real-ip` / `fly-client-ip` /
  `true-client-ip`, falling back to the left-most `x-forwarded-for` hop.
- **Fail-closed by default** (`onStoreError: 'deny'`): if the store is down, the
  gate rejects. Trade-off: a store outage blocks chat. Set `'allow'` to fail-open
  (keep chat up, drop the protection) — your call; it's one config flag.
- **Multi-instance safe** with `createPostgresStore`; `InMemoryStore` is for a
  single instance / tests only.
- **Shared store, many gates** via `keyPrefix`.

## Store — two options

- **Reuse REBUILD's existing `public.rate_limits`** (recommended):
  `createRebuildRateLimitsStore(exec)`. Its live schema is
  `identifier, action, count, window_start` — the limiter key `"<action>:<ip>"`
  splits cleanly into `action`/`identifier`. Needs a one-line unique constraint on
  `(identifier, action, window_start)` for the atomic upsert (see `schema.sql`).
- **Standalone table** `public.rate_limit_counters`: `createPostgresStore(exec)`.
  Use only if you'd rather not touch the shared `rate_limits` table.

Both are RLS-on / service-role-only. `InMemoryStore` is single-instance/tests.

## Tests

```bash
npm run test:ratelimit    # node --test, 9 tests, zero deps
```

Covers: limit enforcement, window reset, per-IP isolation, fail-closed &
fail-open, keyPrefix isolation, IP extraction, the 429 gate, and the Postgres
store's atomic increment contract.

## Not done (needs your ok + v66 access)

- Read `realtime-chat` v66 and confirm the exact insertion point after its 400
  validation (I could not locate v66's source — it lives in a Vercel/GitHub
  location outside this session's scope).
- Pick `windowMs`/`max` for chat.
- Apply `schema.sql` (or map to the existing `rate_limits` table).
- Stage as v67 and show the diff — **no deploy without approval**.
