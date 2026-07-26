// Central AI router.
//
// aiRouter.execute(req) is the ONE service the rest of the application calls.
// It classifies, retrieves policy, runs Claude / OpenAI / both, compares,
// applies SHIELD, enforces human approval, logs, and returns a SINGLE final
// response — never provider-specific formats.
//
// Guarantees:
//   - Loop prevention: a hard cap on provider invocations; comparison is
//     deterministic code, so models never feed each other in a loop.
//   - Cost control: per-request + per-session ceilings via CostLedger.
//   - Fallback: unavailable provider -> failover; if all fail -> safe response.
//   - SHIELD authority: the writing model can never overrule SHIELD.
//   - Level 4 never auto-releases.

import { DEFAULT_CONFIG, type RouterConfig } from '../config.ts'
import { classify, type SupplementalClassifier } from '../classification/classifier.ts'
import { compareDecisions } from '../comparison/compare.ts'
import { RuleBasedShield, type ShieldReviewer } from '../compliance/shield.ts'
import {
  InMemoryApprovalQueue,
  type HumanApprovalQueue,
} from '../approval/queue.ts'
import {
  ConsoleLogger,
  redactProviderResults,
  type DecisionLogger,
} from '../logging/logger.ts'
import { ProviderRegistry } from '../providers/registry.ts'
import type { Provider } from '../types.ts'
import { resolvePlan } from '../policies/policy.ts'
import {
  buildSystemPrompt,
  DECISION_INSTRUCTION,
  DECISION_OUTPUT_SCHEMA,
} from '../knowledge/prompt.ts'
import { validateDecisionOutput } from '../schema/validate.ts'
import { withTimeoutAndRetry } from './retry.ts'
import {
  CostLedger,
  estimateCostUsd,
  InMemorySessionSpend,
  type SessionSpendStore,
} from './costLedger.ts'
import type {
  Classification,
  DecisionOutput,
  ExecuteRequest,
  ProviderName,
  ProviderResult,
  RouterMetrics,
  RouterResult,
  ShieldReview,
} from '../types.ts'

const HOLD_MESSAGE =
  "Thanks — this needs a quick review by a licensed Sunny Financial Group specialist before we share a response. We've routed it and someone will follow up."
const BLOCK_MESSAGE =
  "I can share general education on this, but I'm not able to provide a specific answer here. A licensed Sunny Financial Group agent can help with your situation."
const ERROR_MESSAGE =
  "I'm having trouble responding right now. Please try again shortly."

export interface AiRouterOptions {
  providers: Provider[]
  config?: RouterConfig
  shield?: ShieldReviewer
  logger?: DecisionLogger
  approvalQueue?: HumanApprovalQueue
  sessionSpend?: SessionSpendStore
  supplementalClassifier?: SupplementalClassifier
  /** Injectable clock/id for deterministic tests. */
  now?: () => number
  genId?: () => string
  /** Injectable sleep for retry backoff (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

interface CallOutcome {
  result: ProviderResult | null
  error: string | null
}

let ID_COUNTER = 0

export class AiRouter {
  private readonly config: RouterConfig
  private readonly registry: ProviderRegistry
  private readonly shield: ShieldReviewer
  private readonly logger: DecisionLogger
  private readonly approvalQueue: HumanApprovalQueue
  private readonly sessionSpend: SessionSpendStore
  private readonly supplemental?: SupplementalClassifier
  private readonly now: () => number
  private readonly genId: () => string
  private readonly sleep?: (ms: number) => Promise<void>

  constructor(opts: AiRouterOptions) {
    this.config = opts.config ?? DEFAULT_CONFIG
    this.registry = new ProviderRegistry(opts.providers, {
      failureThreshold: this.config.circuitBreaker.failureThreshold,
      cooldownMs: this.config.circuitBreaker.cooldownMs,
      now: opts.now,
    })
    this.shield = opts.shield ?? new RuleBasedShield()
    this.logger = opts.logger ?? new ConsoleLogger()
    this.approvalQueue = opts.approvalQueue ?? new InMemoryApprovalQueue()
    this.sessionSpend = opts.sessionSpend ?? new InMemorySessionSpend()
    this.supplemental = opts.supplementalClassifier
    this.now = opts.now ?? Date.now
    this.genId = opts.genId ?? (() => `req-${++ID_COUNTER}`)
    this.sleep = opts.sleep
  }

  /** Provider health snapshot for dashboards / status endpoints. */
  health() {
    return this.registry.health()
  }

  async execute(req: ExecuteRequest): Promise<RouterResult> {
    const startedAt = this.now()
    const requestId = req.requestId ?? this.genId()
    const notes: string[] = []
    const metrics: RouterMetrics = {
      totalLatencyMs: 0,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      providerCalls: 0,
      retries: 0,
      fallbacksUsed: 0,
    }

    // 1. Classify (deterministic floor + optional escalation-only supplement).
    const classification = await classify(req, this.config, this.supplemental)

    // 2. Resolve execution plan (mode + providers + availability failover).
    const plan = resolvePlan(req, classification, this.config, this.registry)
    notes.push(...plan.notes)
    if (plan.degraded) metrics.fallbacksUsed += 1

    const ledger = new CostLedger(
      this.config.limits,
      req.userContext?.sessionId,
      this.sessionSpend,
    )
    const system = buildSystemPrompt(req, classification)
    const wantStructured =
      classification.decisionLevel >= 2 || !!req.outputSchema

    const providerResults: ProviderResult[] = []
    const decisions = new Map<ProviderName, DecisionOutput>()

    // Helper: one governed provider call (breaker + cost cap + timeout + retry).
    const callProvider = async (
      name: ProviderName,
      message: string,
      structured: boolean,
    ): Promise<CallOutcome> => {
      if (!this.registry.isAvailable(name)) {
        return { result: null, error: `${name} unavailable (circuit open/missing)` }
      }
      try {
        ledger.reserve()
      } catch (e) {
        return { result: null, error: (e as Error).message }
      }
      const provider = this.registry.get(name)!
      const modelCfg = this.config.models[name]

      const outcome = await withTimeoutAndRetry(
        (signal) =>
          provider.execute({
            system,
            message: structured
              ? `${message}\n\n${DECISION_INSTRUCTION}`
              : message,
            outputSchema: structured ? DECISION_OUTPUT_SCHEMA : req.outputSchema ?? null,
            maxOutputTokens: this.config.limits.maxOutputTokens,
            requiresCurrentResearch: req.requiresCurrentResearch,
            signal,
          }),
        {
          perCallMs: this.config.timeouts.perCallMs,
          maxRetries: this.config.retries.maxPerCall,
          baseDelayMs: this.config.retries.baseDelayMs,
          sleep: this.sleep,
          now: this.now,
        },
      )
      metrics.retries += outcome.retries

      if (!outcome.value) {
        this.registry.recordFailure(name, outcome.error?.message ?? 'unknown')
        return { result: null, error: outcome.error?.message ?? 'call failed' }
      }

      const res = outcome.value
      res.estimatedCostUsd = estimateCostUsd(res.usage, modelCfg)
      ledger.recordCost(res.estimatedCostUsd)
      this.registry.recordSuccess(name, res.latencyMs)

      metrics.providerCalls += 1
      metrics.totalInputTokens += res.usage.inputTokens
      metrics.totalOutputTokens += res.usage.outputTokens
      metrics.totalCostUsd = Number((metrics.totalCostUsd + res.estimatedCostUsd).toFixed(6))
      providerResults.push(res)

      if (structured) {
        const v = validateDecisionOutput(res.text, {
          provider: name,
          model: res.model,
          promptVersion: this.config.promptVersion,
        })
        if (v.ok && v.value) {
          if (v.recovered) notes.push(`${name}: recovered malformed JSON fields`)
          decisions.set(name, v.value)
        } else {
          notes.push(`${name}: structured output invalid (${v.errors[0] ?? 'unknown'})`)
        }
      }
      return { result: res, error: null }
    }

    // 3. Dispatch by execution mode.
    let comparison: RouterResult['comparison'] = null

    if (plan.mode === 'claude_only' || plan.mode === 'openai_only') {
      await callProvider(plan.primary, req.message, wantStructured)
    } else if (plan.mode === 'primary_review') {
      const primaryOut = await callProvider(plan.primary, req.message, wantStructured)
      // Reviewer sees the draft and critiques it (allowed for review mode).
      if (plan.reviewer && primaryOut.result) {
        const reviewMsg = `Independently review this draft response for correctness, compliance, hidden assumptions, and missing evidence. Original task: ${req.message}\n\nDraft:\n${primaryOut.result.text}`
        await callProvider(plan.reviewer, reviewMsg, true)
        const p = decisions.get(plan.primary)
        const r = decisions.get(plan.reviewer)
        if (p && r) comparison = compareDecisions(p, r)
      } else if (!plan.reviewer) {
        notes.push('reviewer unavailable — single-model draft, will escalate for review')
      }
    } else {
      // parallel: BOTH analyze independently — neither sees the other's answer.
      const targets = [plan.primary, plan.reviewer].filter(Boolean) as ProviderName[]
      await Promise.all(targets.map((n) => callProvider(n, req.message, true)))
      const p = decisions.get(plan.primary)
      const r = plan.reviewer ? decisions.get(plan.reviewer) : undefined
      if (p && r) comparison = compareDecisions(p, r)
    }

    // 4. Assemble candidate response + primary structured decision.
    const primaryDecision =
      decisions.get(plan.primary) ??
      (plan.reviewer ? decisions.get(plan.reviewer) : undefined) ??
      null
    const primaryText =
      providerResults.find((r) => r.provider === plan.primary)?.text ??
      providerResults[0]?.text ??
      ''
    const candidate = primaryDecision
      ? primaryDecision.summary || primaryDecision.recommendedAction
      : primaryText

    // Total failure → safe error response (still logged).
    if (providerResults.length === 0) {
      return this.finish(
        req, requestId, 'error', ERROR_MESSAGE, classification, plan.mode,
        null, comparison, null, providerResults, null, metrics, notes, startedAt,
      )
    }

    // 5. SHIELD review — authoritative, cannot be overridden by the writer.
    let shield: ShieldReview | null = null
    if (classification.shieldRequired) {
      shield = await this.shield.review({
        agent: req.agent,
        classification,
        candidateText: candidate,
        structured: primaryDecision,
        userContext: req.userContext,
      })
    }

    // 6. Decide release vs. hold vs. block.
    const mustHold =
      classification.humanApprovalRequired ||
      classification.decisionLevel === 4 ||
      (comparison?.humanReviewRequired ?? false) ||
      shield?.decision === 'ESCALATE' ||
      (shield?.decision === 'REQUIRE_REVISION' && !shield.revisedText)

    if (shield?.decision === 'BLOCK') {
      return this.finish(
        req, requestId, 'blocked', BLOCK_MESSAGE, classification, plan.mode,
        primaryDecision, comparison, shield, providerResults, null, metrics, notes, startedAt,
      )
    }

    if (mustHold) {
      const approvalId = await this.approvalQueue.enqueue({
        requestId,
        agent: req.agent,
        taskType: req.taskType,
        classification,
        candidateResponse: candidate,
        decision: primaryDecision,
        comparison,
        shield,
        reason:
          shield?.reasons.join('; ') ??
          comparison?.recommendedResolution ??
          'human approval required by classification',
        createdAt: this.now(),
      })
      return this.finish(
        req, requestId, 'pending_human_approval', HOLD_MESSAGE, classification, plan.mode,
        primaryDecision, comparison, shield, providerResults, approvalId, metrics, notes, startedAt,
      )
    }

    // SHIELD offered a compliant revision → release that instead.
    const finalText =
      shield?.decision === 'REQUIRE_REVISION' && shield.revisedText
        ? shield.revisedText
        : candidate

    return this.finish(
      req, requestId, 'released', finalText, classification, plan.mode,
      primaryDecision, comparison, shield, providerResults, null, metrics, notes, startedAt,
    )
  }

  private async finish(
    req: ExecuteRequest,
    requestId: string,
    status: RouterResult['status'],
    finalResponse: string,
    classification: Classification,
    executionMode: RouterResult['executionMode'],
    decision: DecisionOutput | null,
    comparison: RouterResult['comparison'],
    shield: ShieldReview | null,
    providerResults: ProviderResult[],
    approvalId: string | null,
    metrics: RouterMetrics,
    notes: string[],
    startedAt: number,
  ): Promise<RouterResult> {
    metrics.totalLatencyMs = this.now() - startedAt
    const result: RouterResult = {
      requestId,
      status,
      finalResponse,
      classification,
      executionMode,
      decision,
      comparison,
      shield,
      providerResults,
      approvalId,
      metrics,
      notes,
    }
    await this.logger.logDecision({
      requestId,
      agent: req.agent,
      taskType: req.taskType,
      status,
      classification,
      executionMode,
      decision,
      comparison,
      shield,
      providerResults: redactProviderResults(providerResults),
      metrics,
      notes,
      createdAt: this.now(),
    })
    return result
  }
}

/** Factory mirroring the spec's `aiRouter.execute({...})` call shape. */
export function createAiRouter(opts: AiRouterOptions): AiRouter {
  return new AiRouter(opts)
}
