import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractJson,
  validateDecisionOutput,
  validateAgainstSchema,
} from '../schema/validate.ts'
import { DECISION_OUTPUT_SCHEMA } from '../knowledge/prompt.ts'

const ctx = { provider: 'openai', model: 'gpt', promptVersion: 'v1' }

test('extractJson handles code fences and leading prose', () => {
  const a = extractJson('```json\n{"a":1}\n```')
  assert.deepEqual(a, { a: 1 })
  const b = extractJson('Sure! Here you go: {"a":2, "b":"x"} — hope that helps')
  assert.deepEqual(b, { a: 2, b: 'x' })
})

test('extractJson returns null for non-JSON', () => {
  assert.equal(extractJson('no json here'), null)
})

test('validateDecisionOutput parses a clean object', () => {
  const raw = JSON.stringify({
    recommendedAction: 'do X', summary: 'sum', businessBenefit: ['b'],
    risks: ['r'], assumptions: [], evidence: [], alternatives: [],
    confidence: 0.9, complianceStatus: 'pass', humanApprovalRequired: false,
    missingInformation: [],
  })
  const v = validateDecisionOutput(raw, ctx)
  assert.ok(v.ok)
  assert.equal(v.recovered, false)
  assert.equal(v.value?.confidence, 0.9)
  assert.equal(v.value?.provider, 'openai')
})

test('validateDecisionOutput recovers malformed/missing fields', () => {
  const raw = 'Here: {"recommendedAction":"do X","confidence":"1.7","complianceStatus":"weird"}'
  const v = validateDecisionOutput(raw, ctx)
  assert.ok(v.ok)
  assert.ok(v.recovered)
  assert.equal(v.value?.confidence, 1) // clamped
  assert.equal(v.value?.complianceStatus, 'review') // defaulted
  assert.deepEqual(v.value?.risks, []) // defaulted
})

test('validateDecisionOutput fails when unparseable / empty', () => {
  const v = validateDecisionOutput('total gibberish no braces', ctx)
  assert.equal(v.ok, false)
  assert.equal(v.value, null)
})

test('validateAgainstSchema enforces required + types + range', () => {
  const errs = validateAgainstSchema({ recommendedAction: 'x', summary: 'y', confidence: 2, complianceStatus: 'nope' }, DECISION_OUTPUT_SCHEMA)
  assert.ok(errs.some((e) => e.includes('confidence')))
  assert.ok(errs.some((e) => e.includes('complianceStatus')))
})
