# Sunny Model Router — Phase 2 Design

**Goal:** add controlled multi-model *decisioning* (4 decision levels, dual-model
comparison, per-application policy packs, structured decisions) to the router that
**already exists**, without a second router and without weakening insurance
compliance.

> Status: **finalized against `sfgnews-ai` — awaiting Jeff's approval. No
> implementation or deployment until approved.** This document is grounded in
> (a) the router's **observable** contract (log schema, routing aliases, provider
> set, SHIELD tables, Railway config) and (b) the **actual `sfgnews-ai` code in
> this repo** (the `sfg_news` publish target — see §1a). The §8 latency-vs-SHIELD
> invariant is confirmed (2026-07-26). **Router internals are now grounded too**
> — `Sonnyheat/sunny-model-router` was read directly (§10b), closing every
> **[needs source]** flag. That read also surfaced a **blocking architectural
> decision** (single- vs cross-provider multi-model; §10b/§11) created by the
> 2026-07-26 Claude consolidation — the dual-model build (§6) waits on Jeff's call.

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

## 1a. What the `sfg_news` side actually is (this repo — grounded)

Verified directly against `sfgnews-ai` source (not inferred). This is the
`sfg_news` **publish target**, and it constrains the `sfg_news` policy pack below.

| Element | Reality in this repo |
|---|---|
| App | Read-only **React/Vite/TS** public news reader. No AI, no generation, no writes — it renders already-published content. |
| Data | Supabase table **`signal_articles`** (project ref `pysqnsjvbqfwiarhrejo`), read via the **anon key** (`src/lib/supabase.ts`, `src/hooks/useArticles.ts`). |
| Columns | `id, headline, slug, pillar, author, date_published, content_en, publish_status, persona_target, signal_event_type` (`src/types/index.ts`). |
| Publish gate | Every query filters **`publish_status = 'published'`** — content is invisible to the public until then. This column **is** the "editorial approval / publishing safeguard." |
| Pillars | `final-expense`, `mortgage-protection`, `debt-action-plan`, `news` — the sfg_news topic taxonomy. |
| Classification fields | `persona_target`, `signal_event_type` already exist — usable as deterministic classifier / policy-key inputs. |
| Localization | `content_en` + `/en/...` routes ⇒ per-locale content model. Each localized variant is a **separate publishable artifact needing its own compliance pass**. |
| Compliance surface | `ArticlePage.tsx` hard-codes "Licensed Insurance Agent — FL License W725473 · Sunny Financial Group" on every article. Even the *News* site publishes under a licensed-agent identity. |

**Two finalization consequences:**

1. **The insurance-compliance floor applies to `sfg_news` too.** The license
   footer on every article is code-level proof that news content is published
   under regulated insurance identity — so §5's "insurance rules are global
   mandatory, editorial rules are application-scoped" is grounded in code, not
   just policy preference.
2. **No router lands in this repo.** There is no AI code here to extend; the
   `sfg_news` integration point is purely the `signal_articles.publish_status`
   lifecycle. The router/generation lives in `sunny-model-router` (+ REBUILD
   edge functions / n8n per the module README). §9's component map targets that
   repo, confirming the reference module must **not** be wired into this app.

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
mandatory, editorial rules application-scoped. Grounded in code: every article
renders under FL License W725473 (§1a), so the floor is not optional for news.

**Grounded mapping to `signal_articles` (this repo):**

- **Editorial approval / publishing safeguard = the `publish_status` lifecycle.**
  Phase-2 does not invent a publish queue; a `sfg_news` decision that clears
  SHIELD + editorial review is what promotes a row to `publish_status='published'`
  (the only state the reader renders). Recommend an explicit ladder —
  `draft → in_review → approved → published` (plus `held`/`rejected`) — with the
  transition to `published` gated on the SHIELD PASS + human editorial approval
  the design already requires. **[needs source: current allowed `publish_status`
  values + who writes them]**
- **Policy key inputs already exist.** `pillar` (topic), `persona_target`, and
  `signal_event_type` are real columns — the deterministic classifier and the
  `routing_policies` key `(application, agent, taskType)` can be derived from
  them for `sfg_news` without new fields.
- **Per-locale compliance.** `content_en` is one localized artifact; any future
  `content_<locale>` is a **separate** publishable unit and gets its **own**
  SHIELD/editorial pass before its own publish flag flips. A passed English
  variant never authorizes release of a translation.

## 6. Dual-model comparison (L3+)

> ⚠️ The "Claude **and OpenAI**" wording below predates the 2026-07-26
> single-provider consolidation — see the blocking tension in §10b, decision
> pending in §11. If Jeff picks single-provider (option 2), read "OpenAI" here as
> "a second, independently-prompted Claude reviewer."

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
shared hub, matching today's layout. Concretely: the `sfg_news` content and its
**`publish_status`** stay in the sfg_news Supabase project (`signal_articles`,
project ref `pysqnsjvbqfwiarhrejo`); the shared Holdings hub stores only the
`decision_records` / `model_router_logs` row and the SHIELD outcome that
*authorizes* the flag flip. The router never reaches across into another app's
content tables — it emits a decision; the owning app applies it.

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

> **Confirmed (§10b): the real router is Python/LiteLLM.** Each row below is a
> **Python rewrite inside `router_app.py`** (or a new sibling module), not a port
> of the TypeScript reference. The TS module stays a spec + test oracle.

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

## 10b. Router source confirmed — Python/LiteLLM (closes the [needs source] items)

Read directly from `Sonnyheat/sunny-model-router` @ `main` (now in session scope).
The production router is **Python + FastAPI + LiteLLM** — **not** TypeScript. The
`services/ai/` module in this repo is therefore a **spec/reference, not portable
code**; every §9 mapping is a **Python rewrite of `router_app.py`**, not a drop-in.

| Prior [needs source] | Resolved fact (real code) |
|---|---|
| Deterministic pre-classifier | `choose_alias(agent, task_type, risk_level)` — purely deterministic: `task_type`-as-alias passthrough → `risk_level` map (`compliance/legal/underwriting/tax/high → compliance_review`; `regulated/public_financial → regulated_public`) → `AGENT_DEFAULT_ALIAS` → `fallback_safe`. **No LLM classifier exists today**, so the "rules before any LLM classify" floor is already met by default. |
| alias → model map | `litellm_config.yaml`. **As of 2026-07-26 every agent-facing alias resolves to `anthropic/claude-sonnet-5` (single provider).** OpenAI/Qwen were removed from the production path; only standalone TEST aliases (`grok_test`=xai grok-4.1-fast, `gpt41_mini_test`=openai gpt-4.1-mini, `perplexity_test`=perplexity sonar-pro) point elsewhere, wired to no agent. |
| retry / breaker / timeout | LiteLLM `num_retries: 2` + declarative `fallbacks` chains + `routing_strategy: simple-shuffle`. **No circuit breaker, no per-request/session cost cap, no loop cap** — genuinely net-new (§9 breaker/costLedger). A 60s provider-health cache + `/health/providers`, `/health/aliases`, `/test-alias` already exist. |
| SHIELD call shape | **The router does NOT call SHIELD.** SHIELD runs as a separate **n8n direct-Anthropic (claude-sonnet-5)** call — `/ai-router` does not forward a caller system prompt (`RouterRequest` has no such field), so SHIELD's ruleset can't be applied in-router. Putting a SHIELD gate *inside* the router is new architecture (forward a system prompt, or call the n8n workflow), not just "formalizing verdict states." |
| `requires_human_review` / `escalation` | `assess(agent, risk_level, alias, risk_flags)` — deterministic; **`escalation` is set equal to `requires_human_review`**. Triggers: risk_level ∈ regulated/compliance/high/legal/underwriting/tax, or `agent==alex`, or alias ∈ {regulated_public, compliance_review}, or any risk_flag ∈ {health, underwriting, tax, legal}. `risk_flags` from a keyword scan (`scan_risk_flags`). |
| logs table | `model_router_logs` migration confirmed (matches §1); RLS on, service-role writes; Supabase project `gukpllhyjatgiuyurdzq` (Sunny Fin Holdings). §7's "add columns" is a Postgres migration on this table. |

**Real contract:** `POST /ai-router` takes snake_case `{agent, task_type, risk_level,
user_message, context{}}` — **no `application` field, no `outputSchema`, no
structured `DecisionOutput`**. Response is one snake_case object (`model_alias,
provider, response, risk_flags, confidence, requires_human_review,
recommended_next_action, estimated_cost_usd, latency_ms`). §3's camelCase target is
aspirational; to stay backward-compatible, Phase-2 fields must be **added alongside**
the existing snake_case ones.

### ⚠️ Blocking design tension — resolve before building §6 (dual-model)

The design's core is **cross-provider** dual-model ("Claude drafts, OpenAI
reviews"; run both independently). But on **2026-07-26 Jeff consolidated every
agent-facing alias to a single provider (`claude-sonnet-5`)**, and the router
repo's own stack note records the rule *"Claude only; NEVER use OpenAI for agent
intelligence"* (OpenAI allowed only for REEL TTS). Building cross-provider
comparison would re-introduce exactly what was just removed. Three reconciliations
— **needs Jeff's call** (§11):

1. **Cross-provider (as originally specced):** re-enable OpenAI as an L3/L4
   *reviewer only*. Maximum independence; contradicts the 2026-07-26 directive.
2. **Single-provider, dual-role (honors consolidation):** two **independent
   Claude** passes — drafter + separately-prompted reviewer/critic — compared
   deterministically. Claude-only; independence is prompt/role-level, not vendor.
3. **Claude + a provisioned test alias for the review leg only:** e.g.
   `perplexity_test` (web-grounded) to fact-check `sfg_news` claims, or
   `grok_test` as an independent second opinion — reuses already-approved test
   providers without broadly re-adding OpenAI.

## 11. Finalization status

**Resolved in this pass (grounded against `sfgnews-ai` code):**

- ✅ §8 latency-vs-SHIELD invariant — **confirmed** by Jeff (2026-07-26); locked.
- ✅ `sfg_news` side grounded against real code (§1a): it is a read-only reader
  over `signal_articles`; the publish gate is `publish_status`; the insurance
  floor provably applies (license footer); no router lands in this repo.
- ✅ §5 editorial/publishing mapped to the real `publish_status` lifecycle and
  existing `pillar` / `persona_target` / `signal_event_type` columns.
- ✅ §7 app-vs-hub data separation made concrete for `sfg_news`.

**Still open — needs Jeff:**

- Approval of the reuse-and-extend data model (§7) before any migration.
- Confirmation of the proposed `publish_status` ladder and who may write it (§5).

**Now resolved — `sunny-model-router` read (§10b):** every router **[needs
source]** flag is closed. Confirmed the router is **Python/LiteLLM**, the
classifier is the deterministic `choose_alias` (no LLM classify), breakers/cost
caps/loop caps are net-new, SHIELD is external n8n (not called in-router), and the
contract is snake_case with no `application`/`DecisionOutput`.

**DECISION (Jeff, 2026-07-26): Option 1 — cross-provider.** OpenAI returns as an
**L3/L4 reviewer only** (drafting stays Claude). This is an **explicit override**,
by Jeff, of the 2026-07-26 single-provider consolidation and the router repo's
"Claude only" stack note — scoped to the review/comparison leg, not a broad
re-add of OpenAI to agent-facing aliases. Recorded so the two documents agree:
the stack doc should be updated to permit OpenAI as a compliance/second-opinion
*reviewer*. Drafting/L1/L2-primary remain `claude-sonnet-5`.

Build consequence: add an OpenAI-backed **reviewer** deployment used only by the
decision engine's review/parallel legs; `choose_alias` and all Phase-1 agent
routing stay Claude-only and byte-for-byte unchanged.

**Also needs Jeff (unchanged):** approval of the §7 data-model migration, and the
`publish_status` ladder + writer for `sfg_news` (§5).

**Build readiness:** decision-*independent* slices can start as soon as approved —
the decision-level policy layer (§4), `routing_policies` loader, `CostLedger` +
loop cap, `human_approvals`, `DecisionOutput` validation, and the §7 migration all
hold regardless of the §6 choice. Only the dual-model comparison step (§6) is
gated on the decision above. **Nothing is implemented, migrated, or deployed yet**,
and the reference module stays reference-only (not wired into any app).
