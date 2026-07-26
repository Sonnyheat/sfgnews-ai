// Sunny Financial Group — Multi-Model Decision Architecture
// Shared, provider-independent types.
//
// The rest of the application depends ONLY on these types, never on a
// provider's raw response shape. Anthropic/OpenAI wire formats are confined
// to their adapters (services/ai/providers/*).

// ---------------------------------------------------------------------------
// Core enums (as const unions — "erasable" so the module runs under Node's
// native type-stripping and under Deno without a build step).
// ---------------------------------------------------------------------------

export type ProviderName = 'anthropic' | 'openai'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** Numeric decision level 1..4 mirrors the four levels in the spec. */
export type DecisionLevel = 1 | 2 | 3 | 4

export const DECISION_LEVEL = {
  ROUTINE: 1,
  REVIEWED: 2,
  DUAL_ANALYSIS: 3,
  HUMAN_APPROVAL: 4,
} as const

export type ExecutionMode =
  | 'claude_only'
  | 'openai_only'
  | 'primary_review' // primary drafts, secondary reviews
  | 'parallel' // both analyze independently, then compare

/** SHIELD verdicts. Deliberately distinct from provider "confidence". */
export type ComplianceStatus = 'pass' | 'review' | 'block'
export type ShieldDecision = 'PASS' | 'REQUIRE_REVISION' | 'ESCALATE' | 'BLOCK'

export type AgreementStatus =
  | 'agree'
  | 'partial'
  | 'disagree'
  | 'critical_disagreement'

// ---------------------------------------------------------------------------
// Request / context
// ---------------------------------------------------------------------------

export interface UserContext {
  /** Opaque caller/session id used for audit + rate limiting. Never PII. */
  sessionId?: string
  visitorId?: string | null
  leadId?: string | null
  /** Is the caller an authenticated internal admin? Gates manual overrides. */
  isAdmin?: boolean
  /** US state code (e.g. "FL") used for state-applicability filtering. */
  state?: string | null
  [key: string]: unknown
}

/**
 * The single public entrypoint contract:
 *   aiRouter.execute(ExecuteRequest) -> RouterResult
 */
export interface ExecuteRequest {
  /** Which agent is asking (alex, mason, dom, bidtrust, shield, links, ...). */
  agent: string
  /** Task category, e.g. "email_rewrite", "customer_education", "architecture". */
  taskType: string
  /** Caller-supplied risk hint. The classifier may RAISE but never silently lower it. */
  riskLevel?: RiskLevel
  userContext?: UserContext
  /** The user/task message. */
  message: string
  /** Pre-retrieved, approved Sunny knowledge (see knowledge retrieval layer). */
  retrievedContext?: RetrievedContext
  /** When set, the model must emit an object matching this JSON schema. */
  outputSchema?: JsonSchema | null
  /** True if the task needs fresh external info (routes to a research-capable path). */
  requiresCurrentResearch?: boolean
  /** Administrator-only manual provider override. Ignored unless isAdmin. */
  providerOverride?: ProviderName | null
  /** Administrator-only manual execution-mode override. Ignored unless isAdmin. */
  executionModeOverride?: ExecutionMode | null
  /** Correlation id for logs; generated if absent. */
  requestId?: string
}

export interface RetrievedContextItem {
  source: string
  kind: string // 'company_policy' | 'compliance_rule' | 'carrier_restriction' | ...
  content: string
  version?: string | null
  effectiveDate?: string | null
  tags?: string[]
}

export interface RetrievedContext {
  items: RetrievedContextItem[]
  /** Free-form summary the caller may pass instead of/alongside items. */
  summary?: string
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface Classification {
  taskType: string
  riskLevel: RiskLevel
  decisionLevel: DecisionLevel
  customerFacing: boolean
  regulatedContent: boolean
  humanApprovalRequired: boolean
  recommendedExecutionMode: ExecutionMode
  /** True if SHIELD review must run before release. */
  shieldRequired: boolean
  /** Which mandatory rule(s) fired — traceable, never a black box. */
  matchedRules: string[]
  reason: string
}

// ---------------------------------------------------------------------------
// Provider adapter contract
// ---------------------------------------------------------------------------

export interface ProviderRequest {
  system?: string
  message: string
  /** When present the adapter must request JSON matching this schema. */
  outputSchema?: JsonSchema | null
  maxOutputTokens?: number
  temperature?: number
  timeoutMs?: number
  requiresCurrentResearch?: boolean
  /** Abort signal wired to the router's timeout. */
  signal?: AbortSignal
}

export interface ProviderResult {
  provider: ProviderName
  model: string
  /** Raw text the model returned (may be JSON string when outputSchema set). */
  text: string
  usage: TokenUsage
  latencyMs: number
  /** Populated by the router, not the adapter. */
  estimatedCostUsd?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface Provider {
  readonly name: ProviderName
  /** Human-readable default model id (informational; policy may override). */
  readonly defaultModel: string
  execute(req: ProviderRequest): Promise<ProviderResult>
}

// ---------------------------------------------------------------------------
// Structured decision output (validated server-side)
// ---------------------------------------------------------------------------

export interface DecisionOutput {
  recommendedAction: string
  summary: string
  businessBenefit: string[]
  risks: string[]
  assumptions: string[]
  evidence: string[]
  alternatives: string[]
  confidence: number // 0..1
  complianceStatus: ComplianceStatus
  humanApprovalRequired: boolean
  missingInformation: string[]
  provider: string
  model: string
  promptVersion: string
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ComparisonResult {
  agreementStatus: AgreementStatus
  sharedRecommendation: string
  materialDifferences: string[]
  uniqueRisks: string[]
  evidenceGaps: string[]
  recommendedResolution: string
  humanReviewRequired: boolean
}

// ---------------------------------------------------------------------------
// SHIELD compliance review
// ---------------------------------------------------------------------------

export interface ShieldInput {
  agent: string
  classification: Classification
  candidateText: string
  structured?: DecisionOutput | null
  userContext?: UserContext
}

export interface ShieldReview {
  decision: ShieldDecision
  status: ComplianceStatus
  reasons: string[]
  /** True if a licensed human must sign off before release. */
  requiresHumanApproval: boolean
  /** Optional revised/safe text SHIELD is willing to release. */
  revisedText?: string | null
}

// ---------------------------------------------------------------------------
// Router result — the single object business logic consumes
// ---------------------------------------------------------------------------

export type RouterStatus =
  | 'released' // final response approved & safe to show the user
  | 'pending_human_approval' // queued; caller must not auto-release
  | 'blocked' // SHIELD blocked; safe fallback returned
  | 'error' // internal failure; safe fallback returned

export interface RouterResult {
  requestId: string
  status: RouterStatus
  /** The single, final response text for the user. Always present. */
  finalResponse: string
  classification: Classification
  executionMode: ExecutionMode
  /** Structured decision (present for Level 2+ / schema requests). */
  decision?: DecisionOutput | null
  comparison?: ComparisonResult | null
  shield?: ShieldReview | null
  providerResults: ProviderResult[]
  /** Set when status === 'pending_human_approval'. */
  approvalId?: string | null
  metrics: RouterMetrics
  /** Non-fatal notes (fallbacks used, retries, recovery, degraded mode). */
  notes: string[]
}

export interface RouterMetrics {
  totalLatencyMs: number
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  providerCalls: number
  retries: number
  fallbacksUsed: number
}

// ---------------------------------------------------------------------------
// Minimal JSON-schema shape used for structured output validation.
// ---------------------------------------------------------------------------

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  minimum?: number
  maximum?: number
  additionalProperties?: boolean
}
