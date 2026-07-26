// Shared Sunny Financial Group context + prompt assembly.
//
// Both providers receive the SAME approved business context (spec §4) so the
// second opinion is genuinely independent, not biased by a different brief.
// We do NOT dump the whole knowledge base into every prompt — the caller passes
// only task-relevant retrievedContext; these constants are the always-on guardrails.

import type {
  Classification,
  ExecuteRequest,
  JsonSchema,
} from '../types.ts'

export const SUNNY_RULES = `You are an AI assistant for Sunny Financial Group.
Motto: "Only What's Best For You – Always."
Operating footprint: Florida-first. Expansion sequence: Florida, Ohio, Indiana, Texas.

Non-negotiable rules:
- Distinguish clearly between GENERAL EDUCATION and PERSONALIZED ADVICE.
- Do NOT provide personalized insurance recommendations, quotes, pricing, suitability
  determinations, or carrier selection. Escalate those to a licensed agent.
- Do NOT impersonate a licensed agent.
- Do NOT give legal, tax, or investment advice.
- Do NOT make unapproved carrier or product claims.
- IUL, FIA, whole life, and other sensitive products require enhanced compliance care.
- No urgency, guarantees, unsupported promises, or misleading claims.
- When a request is consumer-specific and regulated, escalate rather than answer.`

/** JSON schema for the canonical structured DecisionOutput (spec §7). */
export const DECISION_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['recommendedAction', 'summary', 'confidence', 'complianceStatus'],
  properties: {
    recommendedAction: { type: 'string' },
    summary: { type: 'string' },
    businessBenefit: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    alternatives: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    complianceStatus: { type: 'string', enum: ['pass', 'review', 'block'] },
    humanApprovalRequired: { type: 'boolean' },
    missingInformation: { type: 'array', items: { type: 'string' } },
  },
}

function renderContext(req: ExecuteRequest): string {
  const rc = req.retrievedContext
  if (!rc) return ''
  const parts: string[] = []
  if (rc.summary) parts.push(`Context summary: ${rc.summary}`)
  for (const item of rc.items ?? []) {
    const ver = item.version ? ` (v${item.version})` : ''
    parts.push(`- [${item.kind}${ver}] ${item.content}`)
  }
  return parts.length ? `\n\nApproved Sunny context:\n${parts.join('\n')}` : ''
}

/** System prompt shared by every provider for this request. */
export function buildSystemPrompt(
  req: ExecuteRequest,
  classification: Classification,
): string {
  const guard =
    classification.regulatedContent || classification.customerFacing
      ? '\n\nThis task is regulated/customer-facing: stay in general-education mode and escalate anything consumer-specific.'
      : ''
  return `${SUNNY_RULES}\n\nAgent: ${req.agent}. Task: ${req.taskType}. Risk: ${classification.riskLevel}. Decision level: ${classification.decisionLevel}.${guard}${renderContext(req)}`
}

/** Instruction appended when we want a structured DecisionOutput back. */
export const DECISION_INSTRUCTION =
  'Analyze the request and respond with the structured decision object. ' +
  'Set complianceStatus to "block" if releasing this would violate the rules above, ' +
  '"review" if unsure, otherwise "pass". Set humanApprovalRequired true for anything ' +
  'consumer-specific, regulated, legally sensitive, or financially material.'
