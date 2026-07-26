// SHIELD compliance gate.
//
// SHIELD runs AFTER content generation and BEFORE release. Its verdict cannot
// be overridden by the model that wrote the response — the router treats the
// SHIELD result as authoritative.
//
// This module defines the interface plus a deterministic default reviewer that
// enforces the mandatory outcomes already derived by the classifier. In
// production you inject the real SHIELD (the REBUILD edge/n8n compliance
// pipeline) via the ShieldReviewer interface; the router code does not change.

import type {
  ComplianceStatus,
  ShieldDecision,
  ShieldInput,
  ShieldReview,
} from '../types.ts'

export interface ShieldReviewer {
  review(input: ShieldInput): Promise<ShieldReview>
}

function statusFor(decision: ShieldDecision): ComplianceStatus {
  if (decision === 'PASS') return 'pass'
  if (decision === 'BLOCK') return 'block'
  return 'review'
}

/**
 * Deterministic baseline SHIELD. It does NOT replace the real compliance
 * engine — it guarantees a safe floor when the external SHIELD is absent:
 *   - Level 4 / human-approval-required -> ESCALATE
 *   - a model self-reporting complianceStatus 'block' -> BLOCK
 *   - regulated + customer-facing content -> REQUIRE_REVISION unless clean
 */
export class RuleBasedShield implements ShieldReviewer {
  // Phrases that must never appear in released customer-facing content.
  private static readonly DISALLOWED = [
    'guaranteed returns',
    'guaranteed approval',
    'risk-free',
    'act now',
    'limited time offer',
    'you must buy',
    'best investment',
    'tax-free income guaranteed',
  ]

  async review(input: ShieldInput): Promise<ShieldReview> {
    const reasons: string[] = []
    const c = input.classification
    const text = (input.candidateText || '').toLowerCase()

    // Model self-declared block is honored (never downgraded here).
    if (input.structured?.complianceStatus === 'block') {
      reasons.push('model flagged complianceStatus=block')
      return finalize('BLOCK', reasons, true)
    }

    const hits = RuleBasedShield.DISALLOWED.filter((p) => text.includes(p))
    if (hits.length) {
      reasons.push(`prohibited language: ${hits.join(', ')}`)
      return finalize('REQUIRE_REVISION', reasons, false)
    }

    if (c.humanApprovalRequired || c.decisionLevel === 4) {
      reasons.push('classification requires licensed human approval before release')
      return finalize('ESCALATE', reasons, true)
    }

    if (c.regulatedContent && c.customerFacing) {
      // Regulated + customer-facing passes only when it reads as general
      // education (no personalized directive markers).
      const personalized = [' you should ', ' your policy', ' for you specifically', ' i recommend you']
        .some((p) => ` ${text} `.includes(p))
      if (personalized) {
        reasons.push('regulated customer-facing content contains personalized directives')
        return finalize('ESCALATE', reasons, true)
      }
      reasons.push('regulated customer-facing content — passed general-education check')
      return finalize('PASS', reasons, false)
    }

    reasons.push('no compliance triggers')
    return finalize('PASS', reasons, false)
  }
}

function finalize(
  decision: ShieldDecision,
  reasons: string[],
  requiresHumanApproval: boolean,
): ShieldReview {
  return {
    decision,
    status: statusFor(decision),
    reasons,
    requiresHumanApproval,
    revisedText: null,
  }
}
