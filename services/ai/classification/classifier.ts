// Deterministic task classifier.
//
// Folds the mandatory rule set into a structured Classification. An optional
// LLM classifier can be supplied to SUPPLEMENT the result — but it may only
// escalate (raise risk / level, add flags). It can never clear a mandatory
// SHIELD rule. This keeps the compliance floor deterministic and auditable.

import type { RouterConfig } from '../config.ts'
import type {
  Classification,
  DecisionLevel,
  ExecuteRequest,
  ExecutionMode,
  RiskLevel,
} from '../types.ts'
import { RULES, type Signals } from './rules.ts'

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical']

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

function maxLevel(a: DecisionLevel, b: DecisionLevel): DecisionLevel {
  return (a >= b ? a : b) as DecisionLevel
}

/** Optional supplemental classifier (e.g. an LLM). Escalation-only by contract. */
export interface SupplementalClassifier {
  classify(
    req: ExecuteRequest,
    base: Classification,
  ): Promise<Partial<Pick<
    Classification,
    'riskLevel' | 'decisionLevel' | 'customerFacing' | 'regulatedContent' | 'reason'
  >>>
}

export function classifyDeterministic(
  req: ExecuteRequest,
  config: RouterConfig,
): Classification {
  const signals: Signals = {
    agent: (req.agent ?? '').toLowerCase().trim(),
    taskType: (req.taskType ?? '').toLowerCase().trim(),
    text: (req.message ?? '').toLowerCase(),
    callerRisk: req.riskLevel ?? 'low',
    isAdmin: !!req.userContext?.isAdmin,
  }

  // Start from the caller's risk hint and the risk floor for it.
  let riskLevel: RiskLevel = signals.callerRisk
  let decisionLevel: DecisionLevel = config.riskFloor[riskLevel]
  let customerFacing = false
  let regulatedContent = false
  let humanApprovalRequired = false
  let shieldRequired = false
  const matchedRules: string[] = []
  const reasons: string[] = []

  for (const rule of RULES) {
    if (!rule.when(signals)) continue
    matchedRules.push(rule.id)
    reasons.push(rule.effect.reason)
    const e = rule.effect
    if (e.riskFloor) riskLevel = maxRisk(riskLevel, e.riskFloor)
    if (e.levelFloor) decisionLevel = maxLevel(decisionLevel, e.levelFloor)
    if (e.customerFacing) customerFacing = true
    if (e.regulatedContent) regulatedContent = true
    if (e.humanApprovalRequired) humanApprovalRequired = true
    if (e.shieldRequired) shieldRequired = true
  }

  // Risk floor may push the level up even if no rule set a level explicitly.
  decisionLevel = maxLevel(decisionLevel, config.riskFloor[riskLevel])

  // Level 4 always requires human approval and SHIELD.
  if (decisionLevel === 4) {
    humanApprovalRequired = true
    shieldRequired = true
  }
  // Medium+ risk always runs SHIELD before release (spec §9).
  if (RISK_ORDER.indexOf(riskLevel) >= RISK_ORDER.indexOf('medium')) {
    shieldRequired = true
  }

  const recommendedExecutionMode: ExecutionMode =
    config.executionModeByLevel[decisionLevel]

  return {
    taskType: req.taskType,
    riskLevel,
    decisionLevel,
    customerFacing,
    regulatedContent,
    humanApprovalRequired,
    recommendedExecutionMode,
    shieldRequired,
    matchedRules,
    reason: reasons.length
      ? reasons.join(' ')
      : `Defaulted from caller risk '${riskLevel}'.`,
  }
}

/**
 * Merge a supplemental (LLM) classification. Escalation-only: it may raise
 * risk/level and set flags true, never lower them or clear mandatory rules.
 */
export function mergeSupplemental(
  base: Classification,
  supp: Partial<Classification>,
  config: RouterConfig,
): Classification {
  const riskLevel = supp.riskLevel
    ? maxRisk(base.riskLevel, supp.riskLevel)
    : base.riskLevel
  let decisionLevel = supp.decisionLevel
    ? maxLevel(base.decisionLevel, supp.decisionLevel)
    : base.decisionLevel
  decisionLevel = maxLevel(decisionLevel, config.riskFloor[riskLevel])

  const humanApprovalRequired =
    base.humanApprovalRequired || decisionLevel === 4
  const shieldRequired =
    base.shieldRequired ||
    RISK_ORDER.indexOf(riskLevel) >= RISK_ORDER.indexOf('medium')

  return {
    ...base,
    riskLevel,
    decisionLevel,
    customerFacing: base.customerFacing || !!supp.customerFacing,
    regulatedContent: base.regulatedContent || !!supp.regulatedContent,
    humanApprovalRequired,
    shieldRequired,
    recommendedExecutionMode: config.executionModeByLevel[decisionLevel],
    reason: supp.reason ? `${base.reason} ${supp.reason}` : base.reason,
  }
}

export async function classify(
  req: ExecuteRequest,
  config: RouterConfig,
  supplemental?: SupplementalClassifier,
): Promise<Classification> {
  const base = classifyDeterministic(req, config)
  if (!supplemental) return base
  try {
    const supp = await supplemental.classify(req, base)
    return mergeSupplemental(base, supp, config)
  } catch {
    // Supplemental failure never weakens the deterministic floor.
    return base
  }
}
