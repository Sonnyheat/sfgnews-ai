// Deterministic classification rules.
//
// These run BEFORE any LLM classifier and encode Sunny Financial Group's
// mandatory compliance posture. An LLM classifier may only RAISE risk / add
// flags on top of these — it can never clear a mandatory rule. Every fired
// rule is recorded in Classification.matchedRules for audit.

import type { RiskLevel } from '../types.ts'

export interface Signals {
  agent: string // normalized lower-case
  taskType: string // normalized lower-case
  text: string // normalized lower-case message
  callerRisk: RiskLevel
  isAdmin: boolean
}

export interface RuleEffect {
  /** Minimum decision level this rule imposes. */
  levelFloor?: 1 | 2 | 3 | 4
  /** Minimum risk level this rule imposes. */
  riskFloor?: RiskLevel
  customerFacing?: boolean
  regulatedContent?: boolean
  humanApprovalRequired?: boolean
  shieldRequired?: boolean
  /** True if this is a mandatory SHIELD rule (LLM can never override). */
  mandatory?: boolean
  reason: string
}

export interface Rule {
  id: string
  when: (s: Signals) => boolean
  effect: RuleEffect
}

// --- keyword sets -----------------------------------------------------------

const SENSITIVE_PRODUCTS = [
  'iul',
  'indexed universal life',
  'fia',
  'fixed indexed annuity',
  'annuity',
  'whole life',
  'universal life',
  'variable life',
]

const PERSONALIZED_MARKERS = [
  'should i buy',
  'which policy should',
  'best policy for me',
  'recommend a policy',
  'recommend a carrier',
  'my situation',
  'for my family',
  'right for me',
  'suitable for me',
  'how much coverage do i need',
  'what should i get',
]

const PRICING_QUOTE = [
  'quote',
  'premium',
  'how much will it cost',
  'price for',
  'monthly payment',
  'rate for',
  'cost for me',
]

const CARRIER_SELECTION = [
  'which carrier',
  'best carrier',
  'carrier should i',
  'pick a carrier',
  'choose a carrier',
]

const LEGAL_TAX_INVESTMENT = [
  'legal advice',
  'is this legal',
  'tax advice',
  'tax deduction',
  'write off',
  'investment advice',
  'invest in',
  'lawsuit',
  'interpret the contract',
  'interpret this policy',
]

const ACCUSATORY_CONTRACTOR = [
  'fraud',
  'stealing',
  'misconduct',
  'violated',
  'fired for',
  'terminate the contractor',
  'accuse',
  'lying about',
]

const DEPLOY_MARKERS = [
  'deploy to production',
  'production deploy',
  'push to prod',
  'release to production',
  'go live',
  'ship to prod',
]

const STRATEGIC_MARKERS = [
  'architecture',
  'major product change',
  'compliance policy change',
  'policy change',
  'significant spend',
  'software expenditure',
  'revenue decision',
  'screening policy',
  'brand reputation',
  'bidtrust',
]

const CUSTOMER_FACING_TASKS = [
  'customer_education',
  'customer_facing',
  'sales_script',
  'chat_response',
  'education',
  'explainer',
  'faq',
]

const INSURANCE_MARKERS = [
  'insurance',
  'coverage',
  'beneficiary',
  'final expense',
  'mortgage protection',
  'death benefit',
  'underwriting',
  ...SENSITIVE_PRODUCTS,
]

function anyOf(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n))
}

// --- rules ------------------------------------------------------------------

export const RULES: Rule[] = [
  {
    id: 'insurance-customer-facing',
    when: (s) =>
      anyOf(s.text, INSURANCE_MARKERS) ||
      CUSTOMER_FACING_TASKS.includes(s.taskType),
    effect: {
      customerFacing: true,
      regulatedContent: true,
      shieldRequired: true,
      levelFloor: 2,
      riskFloor: 'medium',
      mandatory: true,
      reason: 'Insurance-related or customer-facing content requires SHIELD review.',
    },
  },
  {
    id: 'sensitive-products-enhanced-review',
    when: (s) => anyOf(s.text, SENSITIVE_PRODUCTS),
    effect: {
      regulatedContent: true,
      shieldRequired: true,
      levelFloor: 3,
      riskFloor: 'high',
      mandatory: true,
      reason:
        'IUL/FIA/whole life/annuity subject matter requires enhanced compliance review.',
    },
  },
  {
    id: 'alex-no-personalized-advice',
    when: (s) =>
      s.agent === 'alex' &&
      (anyOf(s.text, PERSONALIZED_MARKERS) ||
        anyOf(s.text, PRICING_QUOTE) ||
        anyOf(s.text, CARRIER_SELECTION)),
    effect: {
      customerFacing: true,
      regulatedContent: true,
      humanApprovalRequired: true,
      shieldRequired: true,
      levelFloor: 4,
      riskFloor: 'high',
      mandatory: true,
      reason:
        'Alex is education-first and must escalate personalized recommendations, pricing/quotes, suitability, and carrier selection to a licensed agent.',
    },
  },
  {
    id: 'personalized-recommendation',
    when: (s) => anyOf(s.text, PERSONALIZED_MARKERS),
    effect: {
      customerFacing: true,
      regulatedContent: true,
      humanApprovalRequired: true,
      shieldRequired: true,
      levelFloor: 4,
      riskFloor: 'high',
      mandatory: true,
      reason:
        'Personalized insurance recommendation / suitability requires licensed human approval.',
    },
  },
  {
    id: 'pricing-quote-escalation',
    when: (s) => anyOf(s.text, PRICING_QUOTE),
    effect: {
      customerFacing: true,
      regulatedContent: true,
      humanApprovalRequired: true,
      shieldRequired: true,
      levelFloor: 4,
      riskFloor: 'high',
      mandatory: true,
      reason: 'Consumer-specific pricing/quotes must be escalated to a licensed agent.',
    },
  },
  {
    id: 'carrier-specific-recommendation',
    when: (s) => anyOf(s.text, CARRIER_SELECTION),
    effect: {
      regulatedContent: true,
      humanApprovalRequired: true,
      shieldRequired: true,
      levelFloor: 4,
      riskFloor: 'high',
      mandatory: true,
      reason:
        'Carrier-specific recommendation requiring a license must be human-approved.',
    },
  },
  {
    id: 'no-legal-tax-investment-advice',
    when: (s) => anyOf(s.text, LEGAL_TAX_INVESTMENT),
    effect: {
      regulatedContent: true,
      humanApprovalRequired: true,
      shieldRequired: true,
      levelFloor: 4,
      riskFloor: 'high',
      mandatory: true,
      reason:
        'No legal, tax, or investment advice — legal interpretations require human approval.',
    },
  },
  {
    id: 'accusatory-contractor-finding',
    when: (s) => anyOf(s.text, ACCUSATORY_CONTRACTOR),
    effect: {
      humanApprovalRequired: true,
      shieldRequired: true,
      levelFloor: 4,
      riskFloor: 'critical',
      mandatory: true,
      reason:
        'Potentially accusatory contractor findings must not be released without human approval.',
    },
  },
  {
    id: 'production-deploy-material-risk',
    when: (s) => anyOf(s.text, DEPLOY_MARKERS),
    effect: {
      humanApprovalRequired: true,
      levelFloor: 4,
      riskFloor: 'high',
      mandatory: true,
      reason: 'Production deployments with material risk require human approval.',
    },
  },
  {
    id: 'strategic-dual-analysis',
    when: (s) => anyOf(s.text, STRATEGIC_MARKERS),
    effect: {
      levelFloor: 3,
      riskFloor: 'high',
      reason:
        'Strategic / architectural / policy / material spend decisions require dual independent analysis.',
    },
  },
]
