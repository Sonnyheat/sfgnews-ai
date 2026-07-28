# ATLAS Phase 1 — Supabase Connection + Real Data Wiring

**Status:** Complete  
**Lovable commit:** 6c4f24f9342c5ce8274b2d1c915ac71bb88bd79b  
**Branch:** claude/atlas-supabase-real-data-qdz603  

## Files Added
- `src/lib/supabase.ts` — Supabase client using VITE env vars (ATLAS project zpdgovvohutqowngkfqo)
- `src/contexts/AuthContext.tsx` — Session management, profile loading, role mapping
- `src/components/LoginScreen.tsx` — Real Supabase Auth email/password login
- `.env` — VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY set to ATLAS Supabase

## Files Modified
- `src/routes/__root.tsx` — AuthProvider wraps AppLayout inside QueryClientProvider
- `src/components/AppLayout.tsx` — Auth gate (loading → spinner, no session → LoginScreen), real user display + Sign Out in TopBar
- `src/routes/clients.tsx` — React Query fetching `public.leads`, search/filter on real data, empty state when 0 rows
- `src/routes/clients.$clientId.tsx` — React Query for lead by ID, Call History placeholder in Activity tab
- `src/routes/index.tsx` — 3 Supabase count queries, updated StatCards, MASON Dialer Status section (placeholder "—" values)

## Known Discrepancies (action required)
1. Jeff's login email in ATLAS Supabase is `jeff@sunnyfingroup.com` — NOT `jrmaio01@gmail.com`
2. Jeff's role in `public.user_profile_roles` is `advisor` — maps to "Advisor", not "Super Admin"
3. `mason_dialer_control` table does not exist — MASON Dialer Status cards show "—" placeholders
4. `public.clients` has no `client_stage` column — "Records Needing Review" still reads from local store
