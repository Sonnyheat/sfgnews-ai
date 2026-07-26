import test from 'node:test'
import assert from 'node:assert/strict'
import { compareDecisions, textSimilarity } from '../comparison/compare.ts'
import type { DecisionOutput } from '../types.ts'

const mk = (o: Partial<DecisionOutput>): DecisionOutput => ({
  recommendedAction: '', summary: '', businessBenefit: [], risks: [],
  assumptions: [], evidence: [], alternatives: [], confidence: 0.5,
  complianceStatus: 'pass', humanApprovalRequired: false, missingInformation: [],
  provider: 'anthropic', model: 'm', promptVersion: 'v', ...o,
})

test('similar recommendations -> agree', () => {
  const a = mk({ recommendedAction: 'Adopt the phased migration plan for the lead pipeline' })
  const b = mk({ recommendedAction: 'Adopt a phased migration plan for the lead pipeline', provider: 'openai' })
  const r = compareDecisions(a, b)
  assert.equal(r.agreementStatus, 'agree')
  assert.equal(r.humanReviewRequired, false)
})

test('different recommendations -> disagree + human review', () => {
  const a = mk({ recommendedAction: 'Rebuild everything from scratch immediately' })
  const b = mk({ recommendedAction: 'Keep the current system and add monitoring only', provider: 'openai' })
  const r = compareDecisions(a, b)
  assert.ok(r.agreementStatus === 'disagree' || r.agreementStatus === 'partial')
  if (r.agreementStatus === 'disagree') assert.ok(r.humanReviewRequired)
})

test('compliance conflict with a block -> critical_disagreement', () => {
  const a = mk({ recommendedAction: 'Publish the guidance', complianceStatus: 'pass' })
  const b = mk({ recommendedAction: 'Publish the guidance', complianceStatus: 'block', provider: 'openai' })
  const r = compareDecisions(a, b)
  assert.equal(r.agreementStatus, 'critical_disagreement')
  assert.ok(r.humanReviewRequired)
})

test('unique risks surfaced from one side only', () => {
  const a = mk({ recommendedAction: 'Proceed', risks: ['regulatory exposure in Ohio'] })
  const b = mk({ recommendedAction: 'Proceed', risks: [], provider: 'openai' })
  const r = compareDecisions(a, b)
  assert.ok(r.uniqueRisks.some((x) => x.includes('Ohio')))
})

test('agreement never yields an auto-final answer field — sharedRecommendation is descriptive when not agreeing', () => {
  const a = mk({ recommendedAction: 'X totally different alpha' })
  const b = mk({ recommendedAction: 'Y unrelated beta gamma', provider: 'openai' })
  const r = compareDecisions(a, b)
  assert.match(r.sharedRecommendation, /No agreed recommendation/)
})

test('textSimilarity basics', () => {
  assert.equal(textSimilarity('', ''), 1)
  assert.equal(textSimilarity('abc def', ''), 0)
  assert.ok(textSimilarity('phased migration plan', 'phased migration plan') > 0.99)
})
