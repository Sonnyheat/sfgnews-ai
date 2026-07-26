-- Sunny Financial Group — Multi-Model Decision Architecture
-- NET-NEW tables only (decision #2: reuse-and-extend existing governance).
--
-- These are the ONLY tables that do not already exist in the REBUILD project
-- (bpzevykybcvotcbfsvvc). Human approval and SHIELD outcomes are routed through
-- the EXISTING tables — do NOT recreate them:
--   * human approval  -> advisor_transfer_queue / compliance_review_queue
--   * decision audit  -> alex_decision_audit / alex_rule_trace (link via request_id)
--   * carrier/product  -> carrier_profiles / carrier_products / alex_carrier_rules
--   * compliance logs  -> compliance_logs / guardrail_audit_logs
--
-- Apply via Supabase migration ONLY after human approval (do not deploy yet).
-- Every table below follows the record lifecycle fields from the spec
-- (status, version, effective/expiry, source, approved_by, applicability, tags).

-- ---------------------------------------------------------------------------
-- 1. decision_records — one row per aiRouter.execute()
-- ---------------------------------------------------------------------------
create table if not exists public.decision_records (
  id               uuid primary key default gen_random_uuid(),
  request_id       text not null unique,
  agent            text not null,
  task_type        text not null,
  status           text not null check (status in
                     ('released','pending_human_approval','blocked','error')),
  decision_level   smallint not null check (decision_level between 1 and 4),
  risk_level       text not null check (risk_level in ('low','medium','high','critical')),
  execution_mode   text not null,
  customer_facing  boolean not null default false,
  regulated        boolean not null default false,
  human_approval_required boolean not null default false,
  matched_rules    text[] not null default '{}',
  recommended_action text,
  summary          text,
  confidence       numeric,
  compliance_status text check (compliance_status in ('pass','review','block')),
  agreement_status text,
  shield_decision  text check (shield_decision in ('PASS','REQUIRE_REVISION','ESCALATE','BLOCK')),
  approval_id      text,                       -- FK-by-convention into advisor_transfer_queue
  prompt_version   text not null,
  -- performance snapshot
  total_cost_usd   numeric not null default 0,
  total_latency_ms integer not null default 0,
  provider_calls   smallint not null default 0,
  retries          smallint not null default 0,
  fallbacks_used   smallint not null default 0,
  notes            text[] not null default '{}',
  -- lifecycle
  version          integer not null default 1,
  source           text default 'ai-router',
  state_applicability text[] default '{}',
  tags             text[] default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_decision_records_agent on public.decision_records(agent);
create index if not exists idx_decision_records_status on public.decision_records(status);
create index if not exists idx_decision_records_created on public.decision_records(created_at desc);

-- ---------------------------------------------------------------------------
-- 2. decision_evidence — evidence / risks / assumptions / disagreements
-- ---------------------------------------------------------------------------
create table if not exists public.decision_evidence (
  id            uuid primary key default gen_random_uuid(),
  request_id    text not null references public.decision_records(request_id) on delete cascade,
  kind          text not null check (kind in
                  ('evidence','risk','assumption','alternative','missing_information',
                   'material_difference','unique_risk','evidence_gap')),
  provider      text,                          -- which model surfaced it (or 'comparison')
  content       text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_decision_evidence_request on public.decision_evidence(request_id);

-- ---------------------------------------------------------------------------
-- 3. provider_performance — per provider-call telemetry & health
-- ---------------------------------------------------------------------------
create table if not exists public.provider_performance (
  id             uuid primary key default gen_random_uuid(),
  request_id     text not null,
  provider       text not null check (provider in ('anthropic','openai')),
  model          text not null,
  role           text not null check (role in ('primary','reviewer','single')),
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  latency_ms     integer not null default 0,
  cost_usd       numeric not null default 0,
  success        boolean not null default true,
  breaker_state  text check (breaker_state in ('closed','open','half_open')),
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_provider_perf_provider on public.provider_performance(provider, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. model_cost_records — rolled-up cost accounting (per request / session)
-- ---------------------------------------------------------------------------
create table if not exists public.model_cost_records (
  id             uuid primary key default gen_random_uuid(),
  request_id     text not null,
  session_id     text,
  agent          text not null,
  provider       text not null,
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_model_cost_session on public.model_cost_records(session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — enable and lock down. Writes come from the service role (edge function);
-- reads are admin-only. Add policies before deploying (do NOT leave RLS off).
-- ---------------------------------------------------------------------------
alter table public.decision_records    enable row level security;
alter table public.decision_evidence   enable row level security;
alter table public.provider_performance enable row level security;
alter table public.model_cost_records  enable row level security;
-- Example (uncomment + adapt to existing role model before deploy):
-- create policy admin_read on public.decision_records for select
--   using (public.is_admin());   -- reuse REBUILD's existing is_admin() helper
