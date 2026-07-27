-- Rate-limit counter storage for the decoupled per-IP gate.
-- Do NOT deploy until approved. Writes come from the edge function via the
-- SERVICE ROLE only.
--
-- ============================================================================
-- OPTION A (RECOMMENDED): reuse REBUILD's EXISTING public.rate_limits table.
-- Verified live schema (project bpzevykybcvotcbfsvvc):
--   id uuid, identifier text, action text, count int, window_start timestamptz,
--   created_at timestamptz. PK = id; NO unique constraint on the counter cols.
-- Use with createRebuildRateLimitsStore(). It needs a unique constraint on
-- (identifier, action, window_start) for the atomic ON CONFLICT upsert:
-- ----------------------------------------------------------------------------
--   -- migration: add_unique_rate_limits
--   alter table public.rate_limits
--     add constraint rate_limits_ident_action_window_key
--     unique (identifier, action, window_start);
--   create index if not exists idx_rate_limits_window_start
--     on public.rate_limits (window_start);
-- (RLS: confirm it's enabled + service-role-only before wiring in — same posture
--  as the shield_prompts/_ghl_probe fixes.)
--
-- ============================================================================
-- OPTION B: standalone table (only if you do NOT want to touch rate_limits).
-- Pairs with createPostgresStore().
-- ----------------------------------------------------------------------------
create table if not exists public.rate_limit_counters (
  bucket_key   text        not null,   -- e.g. 'realtime-chat:203.0.113.7'
  window_start timestamptz not null,   -- floor(now / window) as a timestamp
  window_ms    integer     not null,
  count        integer     not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (bucket_key, window_start)
);
create index if not exists idx_rate_limit_counters_window_start
  on public.rate_limit_counters (window_start);
alter table public.rate_limit_counters enable row level security;
revoke insert, update, delete, truncate, references, trigger, select
  on public.rate_limit_counters from anon, authenticated;

-- NOTE: createPostgresStore() targets `public.rate_limits`; if you choose
-- Option B, point it at rate_limit_counters instead (one identifier change).

-- Optional cleanup of stale windows (schedule via pg_cron or an edge cron):
--   delete from public.rate_limits where window_start < now() - interval '1 hour';
