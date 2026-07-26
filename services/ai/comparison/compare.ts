// Dual-model comparison.
//
// Given two INDEPENDENT decision outputs (neither model saw the other's answer),
// identify agreement, material differences, unique risks, and evidence gaps.
//
// Principles from the spec, enforced here:
//   - Never select a final answer solely because both models agree.
//   - Never average confidence as if it were an objective probability.
//   - Serious disagreement escalates to human review.

import type {
  AgreementStatus,
  ComparisonResult,
  DecisionOutput,
} from '../types.ts'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'with', 'is',
  'are', 'be', 'we', 'should', 'that', 'this', 'it', 'as', 'by', 'at', 'from',
])

function tokens(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )
}

/** Jaccard overlap of significant tokens — a transparent, deterministic proxy. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

function uniqueTo(a: string[], b: string[]): string[] {
  const bt = b.map((x) => x.toLowerCase().trim())
  return a.filter((x) => {
    const xl = x.toLowerCase().trim()
    return !bt.some((y) => textSimilarity(xl, y) >= 0.6)
  })
}

export interface CompareOptions {
  /** Below this action-similarity we treat recommendations as disagreeing. */
  agreeThreshold?: number // default 0.6
  partialThreshold?: number // default 0.3
}

export function compareDecisions(
  primary: DecisionOutput,
  secondary: DecisionOutput,
  opts: CompareOptions = {},
): ComparisonResult {
  const agreeThreshold = opts.agreeThreshold ?? 0.6
  const partialThreshold = opts.partialThreshold ?? 0.3

  const actionSim = textSimilarity(
    primary.recommendedAction,
    secondary.recommendedAction,
  )

  const uniqueRisks = [
    ...uniqueTo(primary.risks, secondary.risks),
    ...uniqueTo(secondary.risks, primary.risks),
  ]

  // Evidence gap: one side cites evidence the other never mentions, or a side
  // explicitly flags missing information.
  const evidenceGaps = [
    ...uniqueTo(primary.evidence, secondary.evidence),
    ...uniqueTo(secondary.evidence, primary.evidence),
    ...primary.missingInformation,
    ...secondary.missingInformation,
  ]

  const materialDifferences: string[] = []
  if (actionSim < agreeThreshold) {
    materialDifferences.push(
      `Recommended actions differ (similarity ${actionSim.toFixed(2)}): "${primary.recommendedAction}" vs "${secondary.recommendedAction}".`,
    )
  }
  if (primary.complianceStatus !== secondary.complianceStatus) {
    materialDifferences.push(
      `Compliance read differs: ${primary.provider}=${primary.complianceStatus}, ${secondary.provider}=${secondary.complianceStatus}.`,
    )
  }
  const assumptionDiff = [
    ...uniqueTo(primary.assumptions, secondary.assumptions),
    ...uniqueTo(secondary.assumptions, primary.assumptions),
  ]
  if (assumptionDiff.length) {
    materialDifferences.push(
      `Differing assumptions: ${assumptionDiff.slice(0, 5).join('; ')}.`,
    )
  }

  // Agreement status. A compliance-status conflict where either side says
  // "block" is treated as critical regardless of textual similarity.
  const eitherBlocks =
    primary.complianceStatus === 'block' || secondary.complianceStatus === 'block'
  const complianceConflict = primary.complianceStatus !== secondary.complianceStatus

  let agreementStatus: AgreementStatus
  if (eitherBlocks && complianceConflict) {
    agreementStatus = 'critical_disagreement'
  } else if (actionSim >= agreeThreshold && !complianceConflict) {
    agreementStatus = 'agree'
  } else if (actionSim >= partialThreshold) {
    agreementStatus = 'partial'
  } else {
    agreementStatus = 'disagree'
  }

  const humanReviewRequired =
    agreementStatus === 'disagree' ||
    agreementStatus === 'critical_disagreement' ||
    eitherBlocks

  // Shared recommendation is a description, NOT an auto-selected final answer.
  // The router decides release; agreement alone never authorizes it.
  const sharedRecommendation =
    agreementStatus === 'agree'
      ? primary.recommendedAction
      : `No agreed recommendation — ${agreementStatus}. Primary: "${primary.recommendedAction}". Secondary: "${secondary.recommendedAction}".`

  const recommendedResolution =
    agreementStatus === 'agree'
      ? 'Both models independently converged; proceed to SHIELD review before release.'
      : agreementStatus === 'partial'
        ? 'Partial agreement; reconcile material differences, then SHIELD review.'
        : 'Escalate to human review — models did not independently agree.'

  return {
    agreementStatus,
    sharedRecommendation,
    materialDifferences,
    uniqueRisks,
    evidenceGaps,
    recommendedResolution,
    humanReviewRequired,
  }
}
