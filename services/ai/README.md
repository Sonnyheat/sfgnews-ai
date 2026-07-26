# Sunny Financial Group — Multi-Model Decision Architecture

A provider-independent AI routing layer that lets **Claude and OpenAI work
together** on Sunny Financial Group decisions while preserving existing systems,
SHIELD compliance, agent behavior, and production stability.

> **Status: DESIGN REFERENCE ONLY — not a production router.**
> A shared production router already exists: **`Sonnyheat/sunny-model-router`**
> (Railway, project `grateful-prosperity`), already serving Anthropic + OpenAI
> (+ Perplexity/Qwen/xAI) across all Sunny apps (SFGNEWS, ALEX, MASON, DOM,
> LEDGER, CORE) and logging to the Holdings `model_router_logs` table.
>
> This module must **not** be wired into sfgnews.ai as a second router — that
> would create the exact duplicate the multi-app brief warns against. It is kept
> as a **tested reference / spec** for the Phase-2 additions (decision levels,
> dual-model comparison, SHIELD gating, structured-output validation). The real
> implementation belongs in `Sonnyheat/sunny-model-router`. See
> `PHASE2_DESIGN.md` for how each component maps onto the existing service.
> Nothing here reads or hardcodes secrets.

## Why this lives here (and where it belongs)

The `sfgnews-ai` repo is the public news reader and has no AI. The real agents
(Alex, Mason, DOM, etc.) live as **Supabase Edge Functions in the REBUILD
project** and call their models inside **n8n** (`alex-chat` forwards to
`.../webhook/alex-response`). The router belongs on that path. This folder is a
portable module so it can move there unchanged once repo access is granted.

## The one call the app makes

```ts
import { createAiRouter, AnthropicProvider, OpenAiProvider } from './services/ai'

const router = createAiRouter({
  providers: [
    new AnthropicProvider({ model: 'claude-sonnet-4-5' }), // key from ANTHROPIC_API_KEY
    new OpenAiProvider({ model: 'gpt-4.1' }),               // key from OPENAI_API_KEY
  ],
  // Optional injections for production:
  // shield:        real SHIELD reviewer (bridges REBUILD compliance pipeline)
  // logger:        SupabaseLogger writing decision_records / provider_performance
  // approvalQueue: adapter writing advisor_transfer_queue / compliance_review_queue
})

const result = await router.execute({
  agent: 'alex',
  taskType: 'customer_education',
  message: userMessage,
  userContext: { sessionId, isAdmin: false, state: 'FL' },
  retrievedContext,          // only task-relevant approved Sunny knowledge
})

// result.finalResponse is the SINGLE response to show the user.
// result.status ∈ released | pending_human_approval | blocked | error
```

Business logic depends only on `RouterResult` — never on a provider's raw
response shape.

## Pipeline

```
execute(req)
  → deterministic classifier (SHIELD rules first; LLM may only escalate)
  → routing policy (mode + primary/reviewer + availability failover)
  → Claude / OpenAI / both  (governed: breaker, timeout, retry, cost cap, loop cap)
  → dual-model comparison   (independent; agreement never auto-authorizes release)
  → SHIELD review           (authoritative; the writer model can't override it)
  → human approval queue    (Level 4 / ESCALATE never auto-releases)
  → single final response + audit log + metrics
```

## Decision levels (spec §2)

| Level | Name | Mode | Behavior |
|------:|------|------|----------|
| 1 | Routine | one model | e.g. email rewrite, internal admin |
| 2 | Reviewed | primary drafts, second reviews | customer education, sales scripts |
| 3 | Dual analysis | both, independent, then compared | architecture, policy, material spend |
| 4 | Human approval | analyze/recommend, never auto-release | personalized advice, legal, carrier-specific |

## Guarantees enforced in code

- **Loop / runaway prevention** — hard cap on provider invocations per request
  (`limits.maxModelCallsPerRequest`), reserved atomically so parallel calls
  can't race past it. Comparison is deterministic code, so models never feed
  each other in a loop.
- **Cost control** — per-request and per-session USD ceilings (`CostLedger`).
- **Fallback** — unavailable provider fails over; if all fail, a safe response.
- **Circuit breakers** — per provider (`closed → open → half_open`), surfaced
  via `router.health()`.
- **SHIELD authority** — SHIELD runs after generation, before release; a model
  self-reporting "block" is honored, never downgraded by the writer.
- **Level 4 never auto-releases** — always queued for a licensed human.
- **Structured output is validated** server-side with safe recovery; malformed
  JSON never reaches the user.
- **No secrets** — adapters read keys from env at call time; logs redact model
  text to a short preview and never contain keys.

## Sunny rules baked into every prompt

Florida-first; general-education vs. personalized-advice separation; no
personalized recommendations / quotes / suitability / carrier selection by
Alex; no legal/tax/investment advice; enhanced review for IUL/FIA/whole life;
no urgency/guarantees/misleading claims. See `knowledge/prompt.ts`.

## Layout

```
services/ai/
  index.ts               public entrypoint (import from here only)
  types.ts               provider-independent contracts
  config.ts              DB-overridable defaults (models, limits, modes)
  router/                orchestration, circuit breaker, retry, cost ledger
  providers/             anthropic + openai adapters, registry/health
  classification/        deterministic classifier + mandatory SHIELD rules
  policies/              execution-plan resolution (+ admin overrides, failover)
  comparison/            dual-model comparison
  compliance/            SHIELD reviewer interface + deterministic baseline
  approval/              human approval queue interface (+ in-memory default)
  logging/               structured decision logging (secret-free)
  knowledge/             shared Sunny context + canonical decision schema
  schema/                structured-output validation + safe recovery
  persistence/schema.sql the 4 NET-NEW tables (reuse existing for the rest)
  __tests__/             45 tests (node --test, zero dependencies)
```

## Configuration is data, not code

Model choice, per-level execution modes, primary/reviewer assignment, timeouts,
retries, and cost ceilings live in `config.ts` and are meant to be overlaid by
REBUILD records (`alex_operational_routing_rules`, `advisor_confidence_rules`,
`prompt_versions`). Administrators change routing without code changes.

## Tests

```bash
npm run test:ai      # or: node --test 'services/ai/__tests__/*.test.ts'
```

45 tests cover the classifier, schema validation/recovery, comparison, circuit
breaker, cost/loop caps, policy failover + admin overrides, adapter secret
handling, and full router flows (release / hold / block / error / retry).

## Not done yet (needs approval / repo access)

- Move into `sunnyfinancial-supabase`; add a Supabase-backed `DecisionLogger`
  and approval-queue adapter (interfaces already defined).
- Wire the n8n `alex-response` path to call the router.
- Apply `persistence/schema.sql` as a migration (RLS policies first).
- Provision `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as edge-function secrets.
