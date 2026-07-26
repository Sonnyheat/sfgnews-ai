// Structured decision logging.
//
// The router emits one DecisionRecord per execute() plus provider-performance
// and cost rows. This module defines the sink interface and a safe default.
//
// PERSISTENCE MAPPING (reuse-and-extend the REBUILD project — decision #2):
//   DecisionRecord         -> new table `decision_records`      (+ links alex_decision_audit)
//   evidence[]             -> new table `decision_evidence`
//   ProviderPerfRecord     -> new table `provider_performance`
//   CostRecord             -> new table `model_cost_records`
//   human approval         -> EXISTING `advisor_transfer_queue` / `compliance_review_queue`
// See persistence/schema.sql for the 4 net-new tables only.
//
// The default ConsoleLogger prints structured JSON and never writes secrets.
// A SupabaseLogger (persistence/supabase-sink.ts) implements the same interface.

import type {
  Classification,
  ComparisonResult,
  DecisionOutput,
  ProviderResult,
  RouterMetrics,
  RouterStatus,
  ShieldReview,
} from '../types.ts'

export interface DecisionRecord {
  requestId: string
  agent: string
  taskType: string
  status: RouterStatus
  classification: Classification
  executionMode: string
  decision: DecisionOutput | null
  comparison: ComparisonResult | null
  shield: ShieldReview | null
  /** Per-provider outputs WITHOUT secrets. */
  providerResults: Array<Omit<ProviderResult, 'text'> & { textPreview: string }>
  metrics: RouterMetrics
  notes: string[]
  /** epoch ms; injected by caller to stay deterministic in tests. */
  createdAt: number
}

export interface DecisionLogger {
  logDecision(record: DecisionRecord): Promise<void>
}

/** Safe default: structured console output, no persistence, no secrets. */
export class ConsoleLogger implements DecisionLogger {
  // eslint-disable-next-line @typescript-eslint/require-await
  async logDecision(record: DecisionRecord): Promise<void> {
    // Only a compact, secret-free summary is emitted at info level.
    console.log(
      JSON.stringify({
        evt: 'ai_router_decision',
        requestId: record.requestId,
        agent: record.agent,
        status: record.status,
        level: record.classification.decisionLevel,
        risk: record.classification.riskLevel,
        mode: record.executionMode,
        agreement: record.comparison?.agreementStatus ?? null,
        shield: record.shield?.decision ?? null,
        costUsd: record.metrics.totalCostUsd,
        latencyMs: record.metrics.totalLatencyMs,
        providerCalls: record.metrics.providerCalls,
      }),
    )
  }
}

export class NoopLogger implements DecisionLogger {
  // eslint-disable-next-line @typescript-eslint/require-await
  async logDecision(): Promise<void> {}
}

/** Build a secret-free provider summary for logs. */
export function redactProviderResults(
  results: ProviderResult[],
): DecisionRecord['providerResults'] {
  return results.map((r) => ({
    provider: r.provider,
    model: r.model,
    usage: r.usage,
    latencyMs: r.latencyMs,
    estimatedCostUsd: r.estimatedCostUsd,
    textPreview: (r.text || '').slice(0, 240),
  }))
}
