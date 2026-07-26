import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDeterministic, mergeSupplemental } from '../classification/classifier.ts'
import { DEFAULT_CONFIG } from '../config.ts'
import type { ExecuteRequest } from '../types.ts'

const base = (o: Partial<ExecuteRequest>): ExecuteRequest => ({
  agent: 'alex',
  taskType: 'general',
  message: '',
  ...o,
})

test('routine internal email -> level 1, claude_only, no SHIELD', () => {
  const c = classifyDeterministic(
    base({ agent: 'ops', taskType: 'email_rewrite', message: 'Rewrite this internal memo more concisely.', riskLevel: 'low' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 1)
  assert.equal(c.recommendedExecutionMode, 'claude_only')
  assert.equal(c.shieldRequired, false)
  assert.equal(c.humanApprovalRequired, false)
})

test('insurance customer education -> SHIELD + level>=2', () => {
  const c = classifyDeterministic(
    base({ taskType: 'customer_education', message: 'Explain how final expense insurance coverage works in general.' }),
    DEFAULT_CONFIG,
  )
  assert.ok(c.shieldRequired)
  assert.ok(c.customerFacing)
  assert.ok(c.regulatedContent)
  assert.ok(c.decisionLevel >= 2)
})

test('IUL subject matter -> enhanced review, level>=3', () => {
  const c = classifyDeterministic(
    base({ taskType: 'education', message: 'Give a general overview of how an IUL builds cash value.' }),
    DEFAULT_CONFIG,
  )
  assert.ok(c.decisionLevel >= 3)
  assert.equal(c.riskLevel, 'high')
  assert.ok(c.matchedRules.includes('sensitive-products-enhanced-review'))
})

test('Alex personalized recommendation -> level 4 human approval', () => {
  const c = classifyDeterministic(
    base({ agent: 'alex', taskType: 'chat_response', message: 'Which policy should I buy for my family?' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 4)
  assert.ok(c.humanApprovalRequired)
  assert.ok(c.shieldRequired)
})

test('pricing/quote -> level 4 escalation', () => {
  const c = classifyDeterministic(
    base({ agent: 'alex', taskType: 'chat', message: 'What is the premium quote for a 55 year old?' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 4)
  assert.ok(c.humanApprovalRequired)
})

test('carrier selection -> level 4', () => {
  const c = classifyDeterministic(
    base({ agent: 'alex', taskType: 'chat', message: 'Which carrier should I choose?' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 4)
})

test('legal/tax/investment -> level 4', () => {
  const c = classifyDeterministic(
    base({ agent: 'alex', taskType: 'chat', message: 'Can you give me tax advice on this write off?' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 4)
})

test('accusatory contractor finding -> level 4 critical', () => {
  const c = classifyDeterministic(
    base({ agent: 'dom', taskType: 'review', message: 'This contractor committed fraud and was lying about hours.' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 4)
  assert.equal(c.riskLevel, 'critical')
})

test('strategic decision -> dual analysis (level 3, parallel)', () => {
  const c = classifyDeterministic(
    base({ agent: 'atlas', taskType: 'planning', message: 'Propose a new system architecture for the lead pipeline.' }),
    DEFAULT_CONFIG,
  )
  assert.equal(c.decisionLevel, 3)
  assert.equal(c.recommendedExecutionMode, 'parallel')
})

test('supplemental classifier can only escalate, never lower the floor', () => {
  const b = classifyDeterministic(
    base({ agent: 'alex', taskType: 'chat', message: 'Which policy should I buy?' }),
    DEFAULT_CONFIG,
  )
  // Attempt to downgrade to level 1 / low risk.
  const merged = mergeSupplemental(b, { decisionLevel: 1, riskLevel: 'low', regulatedContent: false }, DEFAULT_CONFIG)
  assert.equal(merged.decisionLevel, 4)
  assert.equal(merged.riskLevel, 'high')
  assert.ok(merged.humanApprovalRequired)
})
