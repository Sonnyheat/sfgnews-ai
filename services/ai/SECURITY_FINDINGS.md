# Security findings — Sunny Supabase (as of 2026-07-26)

Surfaced while wiring the multi-model work. Read-only scan + two approved fixes.
Nothing here is mass-applied to production — remediation SQL is staged for your ok.

## Fixed (approved + verified)

| Project | Table | Was | Now |
|---|---|---|---|
| Holdings `gukpllhyjatgiuyurdzq` | `shield_prompts` | RLS **off** + anon full write grants — anyone with the anon key could rewrite SHIELD compliance rules | RLS **on**, anon/authenticated write grants revoked, service-role intact, 5 rows still readable |
| REBUILD `bpzevykybcvotcbfsvvc` | `_ghl_probe` | RLS **off** + anon full write grants (scratch table) | RLS **on**, anon/authenticated grants revoked |

## Applied 2026-07-26 (approved)

- **Revoked `anon` INSERT/UPDATE/DELETE/TRUNCATE** on every public table in
  **Holdings** and **SFGNews**. Verified: **0 anon-writable tables remain** in
  both; anon SELECT left intact (49 Holdings / 15 SFGNews) so public reads still
  work; `authenticated` grants untouched (a few tables use authenticated policies).
  Pre-checked first — no table had a write policy that legitimately admits anon,
  so this is a no-op for real traffic and only removes the latent exposure.
- **Revoked `anon`/`authenticated` SELECT on `system_tokens`** (SFGNews) — a
  key/value secret store (`key, value, updated_at`). It was already protected
  (RLS on, no policy) but had an inert anon SELECT grant; removed so a future
  RLS toggle-off can't leak the token. service_role unaffected.
- **REBUILD `bpzevykybcvotcbfsvvc` (done):** of 174 anon-writable tables, revoked
  anon writes on **163**, keeping the **11** that legitimately accept anon writes
  from the browser (verified permissive anon INSERT policies): `alex_sessions,
  analytics_events, appointments, blog_analytics, calculator_sessions,
  conversion_events, geo_leads, listening_events, recruit_training_records,
  user_signals, visitor_profiles`. Verified 11 remain. Good news from the audit:
  the sensitive tables (`leads`, `agent_credentials`, `alex_tokens`, `user_roles`,
  `compliance_*`, `ghl_calendars`, `lead_profiles`, `advisor_transfer_queue`)
  already had explicit `Deny anon ... USING false` policies — RLS was well-built;
  the broad grants were the only gap, now closed.
  - Follow-up (optional): the 11 kept tables only need anon INSERT; consider
    revoking anon UPDATE/DELETE/TRUNCATE on them too (left intact for now to avoid
    breaking any upsert flows).
- **Remaining projects swept (2026-07-26):**
  - **Links** — revoked anon writes on all 6 anon-writable tables (no legit anon path).
  - **Atlas** — revoked anon writes on the 42 non-telemetry tables; kept 3
    INSERT-only telemetry (`ai_ensemble_results`, `market_intelligence`,
    `security_events`).
  - **10of10** — revoked the non-telemetry table; kept 6 INSERT-only telemetry
    (`analytics_events`, `conversion_funnel`, `daily_metrics`, `subscribers`,
    `territories`, `voice_chat_sessions`).
  - **DOM** — revoked anon writes on the 16 non-flagged tables; `gsc_data` left
    pending (wide-open `ALL/public/true` — see below).
  - **REEL** — revoked anon writes on the 12 non-flagged tables; 5 `reel_*`
    content tables left pending (wide-open `ALL/anon/true` — see below).

## 🔴 CRITICAL — needs a decision (not auto-remediated)

Some projects have **wide-open `ALL … USING true / WITH CHECK true`** policies for
anon/public — full read + write + delete via the public anon key:

- **LEDGER `xlyqnwlhxuqjfyewizwr` — financial data fully exposed.** All 8 tables
  (`transactions`, `commissions`, `chargebacks`, `tax_estimates`,
  `bank_statement_uploads`, `chart_of_accounts`, `vendor_rules`, `mileage_log`)
  are anon `ALL/true`. Diagnostic: **0 restricted policies, 0 auth users** — the
  app has NO authentication and relies entirely on the anon key. Revoking anon
  would take it offline; the real fix is adding Supabase Auth or a service-role
  backend. **Left untouched pending your decision.**
- **DOM `giggixjpjcodvigvkekc`** — `gsc_data` is anon `ALL/true`.
- **REEL `lszjzhpytiqtklrokzpz`** — `reel_clips/published/review_queue/sync_log/videos`
  are anon `ALL/true`.

These are architectural (auth model) fixes, not grant tweaks — do not blanket-
revoke without confirming each app authenticates users or moves to service-role.
- **Noted misconfig:** Holdings `reel_nlp_calibration` has a policy named
  "Service role full access" that is actually `roles={public}` with `using=true`
  (would admit any role). Anon can no longer reach it (grant revoked), but the
  policy should be rewritten to `auth.role() = 'service_role'` to match its name.

## Latent risk (original finding — now remediated on the two hubs above)

Dozens of tables in **Holdings** and **SFGNews** carry broad **`anon` INSERT/UPDATE/
DELETE/TRUNCATE grants**. These are **currently inert** because RLS is enabled and
(verified on the crown jewels below) there is **no anon-permissive policy** — only
`service_role` ALL (+ some `authenticated` SELECT). So anon writes are blocked today.

The danger is structural: the grant is a loaded gun. The moment RLS is disabled on
any such table — which already happened twice (`shield_prompts`, `_ghl_probe`) — the
anon write path goes live instantly with no second line of defense.

Verified service-role-only (no anon policy) — safe today, still grant-exposed:
`model_router_logs`, `shield_flags`, `compliance_rules`, `mason_consent_records`
(TCPA consent, 3,183 rows), `scribe_voice_dna`, `carriers`.

Same grant pattern (not individually policy-checked): all `scribe_*`, all `reel_*`,
all `gbp_*`, `mason_*`, `service_pages`, `city_pages`, `whale_analytics`,
`appointments`, `call_notes`, `video_content` (Holdings); all `signal_*`,
`articles`, `sfg_briefs`, `system_tokens`, `signal_articles_backup_20260726`
(SFGNews).

### Recommended remediation (defense-in-depth)

Writes already go through the **service role** (router + edge functions), so anon
never needs write. Revoke it everywhere as a belt to RLS's suspenders:

```sql
-- Per project. Review first — confirms no legitimate anon-write path exists.
do $$
declare r record;
begin
  for r in
    select table_name
    from information_schema.role_table_grants
    where table_schema='public' and grantee='anon'
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    group by table_name
  loop
    execute format(
      'revoke insert, update, delete, truncate on public.%I from anon, authenticated',
      r.table_name);
  end loop;
end $$;
```

Then re-verify every table has RLS enabled (`relrowsecurity=true`). Consider a
Postgres event trigger or a scheduled advisor check that alerts if any public
table ever has RLS disabled, so a future toggle-off is caught immediately.

## Not audited

Only the two fixed tables + the six crown-jewel policy checks were done in depth.
Not scanned table-by-table: the rest of REBUILD, and Atlas / LEDGER / DOM / Links /
10of10 / REEL projects. Recommend running the same scan there before Phase-2 go-live.

## `system_tokens` (SFGNews) — check this one

`public.system_tokens` (1 row) is anon-writable at the grant level and its name
suggests it holds tokens/secrets. Confirm RLS is enabled with no anon policy, and
that no secret is readable via the anon key. Flagging for a direct look.
