# Sunny Model Router — Phase 2 Design

**Goal:** add controlled multi-model *decisioning* (4 decision levels, dual-model
comparison, per-application policy packs, structured decisions) to the router that
**already exists**, without a second router and without weakening insurance
compliance.

> Status: design for review. No implementation until approved. This document is
> grounded in the router's **observable** contract (its log schema, routing
> aliases, provider set, SHIELD tables, Railway config). Some internals need the
> `Sonnyheat/sunny-model-router` source to finalize — flagged as **[needs source]**.

---

## 1. What already exists (Phase 1)

| Element | Reality today |
|---|---|
| Service | `Sonnyheat/sunny-model-router` (branch `main`) on **Railway** project `grateful-prosperity`, domain `sunny-model-router-production.up.railway.app:8080` |
| Providers | Anthropic, OpenAI, Perplexity, Qwen (DashScope), xAI — all keys already in Railway env |
| Applications | Per-app Supabase service keys: **SFGNEWS, ALEX, MASON, DOM, LEDGER, CORE** |
| Entry contract | `agent`, `task_type`, `risk_level`, `user_message`, `context` (jsonb), `source_system`, `lead_id`, `session_id` |
| Routing | Semantic **`model_alias`** → provider/model (`content_draft`, `technical_reasoning`, `voice_intake`, `content_review`, `compliance_review`, `regulated_public`, `fallback_safe`) |
| Output/telemetry | `provider`, `model`, `input/output_tokens`, `estimated_cost`, `risk_flags[]`, `confidence`, `requires_human_review`, `escalation`, `recommended_next_action`, `final_action_taken`, `latency_ms`, `status`, `error` |
| Audit log | Holdings `model_router_logs` (~9,940 calls) |
| SHIELD | Holdings `shield_prompts` (scope `core_rules` shared; per-consumer wrappers) + `shield_flags` hold queue |
| Human review | `requires_human_review` on 3,121 logged calls; `shield_flags` = "held pending Jeff review" |
| Consumers | scribe, mason, shield, reel, clarity, alex, sfg |

**Conclusion:** provider-independence, multi-provider, multi-app identity
(`source_system`), fallback (`fallback_safe`), cost/latency logging, SHIELD, and
human-hold already exist. Phase 2 is **additive**, not a rebuild.

## 2. Gap analysis (spec → what's missing)

| Spec requirement | Status | Phase-2 work |
|---|---|---|
| Provider-independent router | ✅ exists | none |
| Claude/OpenAI only, fallback | ✅ exists | none |
| **4 decision levels** | ❌ | add decision-level policy layer |
| **primary_review** (draft→review) | ❌ (single-model per alias) | add 2-model mode |
| **parallel independent + comparison** | ❌ | add parallel mode + comparison step |
| **Structured decision schema** | ⚠️ partial (`confidence`,`risk_flags`) | add full `DecisionOutput` for L2+ |
| SHIELD gate | ✅ exists | formalize PASS/REQUIRE_REVISION/ESCALATE/BLOCK states |
| Human approval queue | ✅ `shield_flags` | add `human_approvals` view/table + level-4 hard hold |
| Deterministic classifier before LLM | ⚠️ [needs source] | ensure explicit rule layer precedes any LLM classify |
| Per-application policies | ⚠️ `source_system` logged | add explicit **application** policy packs |
| Provider health / circuit breakers | ⚠️ [needs source] | add breakers + `/health` |
| Loop / token caps | ⚠️ [needs source] | add hard call cap + budget ceilings |

## 3. Target request contract (backward-compatible)

Add an explicit `application` field (today inferred from `source_system`). Keep
every existing field so current callers keep working.

```jsonc
{
  "application": "sunny_financial_group" | "sfg_news",
  "agent": "alex" | "news_editor" | "mason" | "scribe" | ...,
  "taskType": "customer_education" | "article_fact_review" | ...,
  "riskLevel": "low|medium|high|critical",   // hint; classifier may only raise it
  "userContext": { "sessionId": "...", "leadId": "...", "isAdmin": false, "state": "FL" },
  "message": "...",
  "retrievedContext": { /* task-relevant approved knowledge only */ },
  "outputSchema": null,
  "requiresCurrentResearch": false
}
```

Response stays a **single** `finalResponse` plus decision/comparison/shield/metrics
(see the reference module's `RouterResult`).

## 4. Decision levels as a policy layer

Deterministic classifier (reference: `classification/`) runs first and returns
`decisionLevel` + `recommendedExecutionMode`. Policy is **data**, keyed by
`(application, agent, taskType)`, stored in Holdings so admins change routing
without deploys.

- **L1 Routine** → one model (current alias behavior). *Fast path — no added latency.*
- **L2 Reviewed** → `primary_review` (Claude drafts, OpenAI reviews).
- **L3 Dual analysis** → `parallel` independent + comparison.
- **L4 Human approval** → analyze + recommend, **never auto-release**.

Mandatory floors are **not** overridable by the LLM classifier or by the latency
priority (see §8).

## 5. Application policy packs

Two policy packs over the same engine (neither weakens the other):

| | `sunny_financial_group` | `sfg_news` |
|---|---|---|
| Priorities | Alex education-first, insurance compliance, personalized-question detection, licensed-agent escalation, appointment handoff, customer privacy | factual verification, current-source/citation requirements, defamation/reputational risk, financial-claim review, editorial approval, publishing safeguards |
| Mandatory SHIELD | insurance rules (IUL/FIA/whole-life enhanced; no personalized advice/quotes/carrier selection) | financial-claim + defamation review before publish |
| Level-4 triggers | personalized recommendation, pricing/quote, carrier selection, legal/tax | accusatory/defamatory claims, unverified financial claims, licensing/consumer-rights statements |

**Hard rule:** SFG News editorial policy may relax *tone/length/formatting*, never
the SFG **insurance-compliance** floor. Enforced by making insurance rules global
mandatory, editorial rules application-scoped.

## 6. Dual-model comparison (L3+)

Run Claude and OpenAI **independently** (neither sees the other's draft), then a
deterministic comparison (reference: `comparison/compare.ts`) → agreement status,
material differences, unique risks, evidence gaps. Agreement **never** auto-releases;
serious disagreement escalates. Confidence scores are never averaged.

## 7. Data model — reuse-and-extend (all in Holdings, next to `model_router_logs`)

Reuse existing; add only what's missing.

| Need | Reuse | Add |
|---|---|---|
| Per-call telemetry / provider perf / cost | `model_router_logs` | add `decision_id`, `application`, `decision_level`, `execution_mode`, `role` (primary/reviewer) columns |
| Decision group (one execute, N calls) | — | `decision_records` (links the calls, holds final `DecisionOutput`) |
| Evidence / disagreements | `risk_flags` | `decision_evidence` |
| SHIELD outcomes | `shield_flags`, `shield_prompts` | add `shield_decision` enum on the flag |
| Human approvals | `shield_flags` (hold queue) | `human_approvals` view over held items + approver/status |
| Routing policy | alias config **[needs source]** | `routing_policies (application, agent, task_type → level, mode, primary, reviewer)` |
| Knowledge lifecycle fields | `compliance_rules`, `shield_prompts`, `scribe_*` | ensure status/version/effective/expiry/source/approved_by/applicability/tags/created/updated present |

No customer insurance data is combined with news workflows — those stay in their
per-app Supabase projects; only routing/telemetry/compliance metadata lives in the
shared hub, matching today's layout.

## 8. Latency priority ("prosper/speed outweighs")

Interpretation: minimize response latency. Design honors it **without** bypassing
insurance compliance:

- L1 routine stays single-model (no comparison overhead).
- Dual-model + comparison only on L3–L4 (high-impact), where correctness > ms.
- SHIELD fast-path: skip full review for internal, non-regulated, non-customer-facing
  L1 tasks; always run it for regulated/customer-facing insurance content.
- Streaming primary response while reviewer/SHIELD runs async is possible for L2
  **[needs source]** — but a regulated response is not *released* until SHIELD passes.

**CONFIRMED RULE (Jeff, 2026-07-26):** speed optimizations (fast single-model L1,
streaming, async review) are permitted, **but a regulated / customer-facing
insurance response is never released before SHIELD passes.** SFG News editorial
speed never overrides SFG insurance compliance. This is a hard invariant: no
policy, flag, or latency budget may release regulated insurance content ahead of
the SHIELD gate.

## 9. Component map (reference module → real router)

| Reference (`services/ai/…`) | Lands in `sunny-model-router` as |
|---|---|
| `classification/` (deterministic + rules) | pre-routing classifier module |
| `policies/policy.ts` | `routing_policies` loader + execution-plan resolver |
| `providers/*` + `registry` + `circuitBreaker` | extend existing provider layer with breakers/health |
| `comparison/compare.ts` | new L3 comparison step |
| `compliance/shield.ts` (interface) | thin client over existing `shield_prompts`/`shield_flags` |
| `schema/validate.ts` | server-side `DecisionOutput` validation |
| `router/costLedger.ts` | per-request/session caps on top of existing cost logging |
| `logging/logger.ts` + `persistence/schema.sql` | column adds to `model_router_logs` + 3 small tables |

## 10. Rollout (matches your order)

1. Branch `sunny-model-router`; build Phase 2 behind a per-`application` flag; test in a non-prod Railway environment.
2. Enable for `sunny_financial_group` L1–L2 first; verify Alex + SHIELD + escalation against `shield_flags`.
3. Stabilize logging/cost/rollback (flag off = exact Phase-1 behavior).
4. Enable L3–L4 for high-impact SFG decisions.
5. Enable for `sfg_news`; add editorial/fact/citation policies.
6. Expand after separate eval tests pass per application.

**Rollback:** every Phase-2 path is gated by an `application`+`level` flag in
`routing_policies`; setting it off reverts that app/level to current alias routing
with zero code change. Each app is independent (separate keys, separate flags).

## 10a. Observed facts (resolves several [needs source] items from live data)

Mined from Holdings `model_router_logs` and `shield_prompts` — no source code needed.

**Actual `model_alias → provider/model` routing (from ~9,940 calls):**

| Alias | Primary model (observed) | Role | Notes |
|---|---|---|---|
| `content_draft` | **anthropic / claude-sonnet-4-6** (9,116) | long-form drafting | Claude is primary drafter ✅ matches spec |
| `content_review` | **openai / gpt-4o** (104) | second-opinion review | OpenAI reviews ✅ |
| `technical_reasoning` | **openai / gpt-4o-mini** (329) | structured reasoning | OpenAI for logic ✅ |
| `compliance_review` | **openai / gpt-4o** (83) + claude-sonnet-5 (2) | SHIELD scan model | |
| `voice_intake` | openai / gpt-4o (+mini, +gpt-4.1-mini) | Mason voice sessions | |
| `regulated_public` | gpt-4o-mini (7) + claude-sonnet-5 (3) | regulated public content | |
| `fallback_safe` | openai / gpt-4o (1) | fallback path | confirms fallback exists |

Implication: the spec's Claude-drafts/OpenAI-reviews split **already exists** as
separate alias calls (`content_draft` then `content_review`). Phase-2's
`primary_review` mode just formalizes that pair into one `execute()` with a
comparison + single final response — it is not new behavior, it's consolidation.

> Note: live models are newer than the reference module's placeholders. Real IDs:
> `claude-sonnet-4-6`, `claude-sonnet-5`, `gpt-4o-2024-08-06`, `gpt-4o-mini`,
> `gpt-4.1-mini`. Update `config.ts` model IDs to match when porting.

**Actual SHIELD architecture:**

- SHIELD runs as an **n8n workflow** `O6eGqdvHtlKfr3AS` ("SUNNY — SHIELD Compliance
  Scan"), invoked via the `compliance_review` alias / `shield` agent.
- It composes its prompt from `shield_prompts`: shared **`core_rules`** (v2,
  federal compliance — "F1: no misleading statements… F2: no investment/profit/
  savings-plan language…") + a **verdict/output wrapper** (`general_gate_output`
  v4 with an "ALEX VERDICT LAYER": GREEN/… verdicts, disclaimer, JSON format,
  routing) + per-consumer scope wrappers (`mason_script_output` for call scripts,
  `reel_clip_output` for short video).
- So SHIELD is **already the shared, multi-app gate** with shared core + per-app
  wrappers. Phase-2 maps PASS/REQUIRE_REVISION/ESCALATE/BLOCK onto its existing
  GREEN/YELLOW/RED-style verdict layer rather than inventing a new gate.
- `compliance/shield.ts` in the reference module should therefore be a **thin
  client that calls this n8n workflow** (and honors its verdict), not a
  reimplementation. The deterministic `RuleBasedShield` stays only as an offline
  safe-fallback for tests/degraded mode.

**Still genuinely needs the router source** (`Sonnyheat/sunny-model-router`):
the deterministic pre-classifier (if any), the alias-selection logic, retry/
breaker/timeout internals, and how `requires_human_review`/`escalation` are set.

## 11. To finalize this design I need

- Read access to **`Sonnyheat/sunny-model-router`** (resolves every **[needs source]**:
  current classifier, alias→model map, SHIELD call shape, fallback/breaker logic).
- Confirmation on the §8 latency-vs-SHIELD question.
- Approval of the reuse-and-extend data model (§7) before any migration.
