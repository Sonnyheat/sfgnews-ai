# Security findings — Sunny Supabase (as of 2026-07-26)

Surfaced while wiring the multi-model work. Read-only scan + two approved fixes.
Nothing here is mass-applied to production — remediation SQL is staged for your ok.

## Fixed (approved + verified)

| Project | Table | Was | Now |
|---|---|---|---|
| Holdings `gukpllhyjatgiuyurdzq` | `shield_prompts` | RLS **off** + anon full write grants — anyone with the anon key could rewrite SHIELD compliance rules | RLS **on**, anon/authenticated write grants revoked, service-role intact, 5 rows still readable |
| REBUILD `bpzevykybcvotcbfsvvc` | `_ghl_probe` | RLS **off** + anon full write grants (scratch table) | RLS **on**, anon/authenticated grants revoked |

## Latent risk (NOT yet remediated — needs your ok)

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
