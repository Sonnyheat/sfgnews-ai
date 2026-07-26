// Cost estimation + budget enforcement.
//
// Enforces per-request and per-session spend ceilings and the hard cap on
// provider invocations per request. These are the runaway-token / cost-control
// guarantees from the spec. Session spend is tracked via an injectable store so
// production can back it with Redis/Postgres; the default is in-memory.

import type { ModelConfig } from '../config.ts'
import type { TokenUsage } from '../types.ts'

export function estimateCostUsd(usage: TokenUsage, model: ModelConfig): number {
  const input = (usage.inputTokens / 1_000_000) * model.inputPer1M
  const output = (usage.outputTokens / 1_000_000) * model.outputPer1M
  return Number((input + output).toFixed(6))
}

/** Rough pre-call token estimate (~4 chars/token) for admission checks. */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4)
}

export interface SessionSpendStore {
  get(sessionId: string): number
  add(sessionId: string, usd: number): void
}

export class InMemorySessionSpend implements SessionSpendStore {
  private readonly map = new Map<string, number>()
  get(sessionId: string): number {
    return this.map.get(sessionId) ?? 0
  }
  add(sessionId: string, usd: number): void {
    this.map.set(sessionId, this.get(sessionId) + usd)
  }
}

export interface LedgerLimits {
  maxModelCallsPerRequest: number
  maxCostUsdPerRequest: number
  maxCostUsdPerSession: number
}

export class BudgetExceededError extends Error {}
export class CallCapExceededError extends Error {}

/** Tracks spend + call count for a single execute() invocation. */
export class CostLedger {
  private requestSpend = 0
  private calls = 0
  readonly notes: string[] = []
  private readonly limits: LedgerLimits
  private readonly sessionId: string | undefined
  private readonly sessionStore: SessionSpendStore

  constructor(
    limits: LedgerLimits,
    sessionId: string | undefined,
    sessionStore: SessionSpendStore,
  ) {
    this.limits = limits
    this.sessionId = sessionId
    this.sessionStore = sessionStore
  }

  /**
   * Atomically reserve one provider-call slot. Throws if the call cap or a
   * budget ceiling would be breached. Reservation increments the counter
   * synchronously (before any await), so the cap holds even when parallel
   * calls are launched together — this is the loop/runaway guard.
   */
  reserve(): void {
    if (this.calls >= this.limits.maxModelCallsPerRequest) {
      throw new CallCapExceededError(
        `model-call cap reached (${this.limits.maxModelCallsPerRequest}) — loop/runaway guard`,
      )
    }
    if (this.requestSpend >= this.limits.maxCostUsdPerRequest) {
      throw new BudgetExceededError('per-request budget exhausted')
    }
    const sessionSpent = this.sessionId
      ? this.sessionStore.get(this.sessionId)
      : 0
    if (sessionSpent >= this.limits.maxCostUsdPerSession) {
      throw new BudgetExceededError('per-session budget exhausted')
    }
    this.calls += 1
  }

  /** Record the cost of a reserved call once it completes. */
  recordCost(costUsd: number): void {
    this.requestSpend += costUsd
    if (this.sessionId) this.sessionStore.add(this.sessionId, costUsd)
  }

  get spend(): number {
    return Number(this.requestSpend.toFixed(6))
  }
  get callCount(): number {
    return this.calls
  }
}
