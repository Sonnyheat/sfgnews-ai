-- Rate-limit counter table for the decoupled per-IP gate.
--
-- REBUILD already has a `public.rate_limits` table (0 rows). Adapt this to it if
-- the columns match; otherwise apply as-is. Writes come from the edge function
-- via the SERVICE ROLE only. Do NOT deploy until approved.

create table if not exists public.rate_limits (
  bucket_key   text        not null,   -- e.g. 'realtime-chat:203.0.113.7'
  window_start timestamptz not null,   -- floor(now / window) as a timestamp
  window_ms    integer     not null,
  count        integer     not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

create index if not exists idx_rate_limits_window_start
  on public.rate_limits (window_start);

-- Lock down: service role only (bypasses RLS); anon/authenticated get nothing.
alter table public.rate_limits enable row level security;
revoke insert, update, delete, truncate, references, trigger, select
  on public.rate_limits from anon, authenticated;

-- Optional cleanup of stale windows (schedule via pg_cron or an edge cron):
--   delete from public.rate_limits where window_start < now() - interval '1 hour';
