import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlan } from '../policies/policy.ts'
import { ProviderRegistry } from '../providers/registry.ts'
import { classifyDeterministic } from '../classification/classifier.ts'
import { DEFAULT_CONFIG } from '../config.ts'
import { FakeProvider } from './fakes.ts'
import type { ExecuteRequest } from '../types.ts'

function registry() {
  return new ProviderRegistry(
    [new FakeProvider({ name: 'anthropic' }), new FakeProvider({ name: 'openai' })],
    { failureThreshold: 2, cooldownMs: 10_000 },
  )
}

const req = (o: Partial<ExecuteRequest>): ExecuteRequest => ({ agent: 'alex', taskType: 'general', message: '', ...o })

test('default level-2 plan is primary_review with claude primary', () => {
  const r = req({ taskType: 'customer_education', message: 'Explain final expense coverage generally.' })
  const c = classifyDeterministic(r, DEFAULT_CONFIG)
  const plan = resolvePlan(r, c, DEFAULT_CONFIG, registry())
  assert.equal(plan.mode, 'primary_review')
  assert.equal(plan.primary, 'anthropic')
  assert.equal(plan.reviewer, 'openai')
})

test('failover when primary breaker is open', () => {
  const reg = registry()
  reg.recordFailure('anthropic', 'x'); reg.recordFailure('anthropic', 'x') // opens breaker
  const r = req({ taskType: 'customer_education', message: 'Explain final expense coverage generally.' })
  const c = classifyDeterministic(r, DEFAULT_CONFIG)
  const plan = resolvePlan(r, c, DEFAULT_CONFIG, reg)
  assert.equal(plan.primary, 'openai') // failed over
  assert.ok(plan.degraded)
})

test('admin provider override honored; non-admin ignored', () => {
  const r1 = req({ taskType: 'planning', message: 'Design architecture.', providerOverride: 'openai', userContext: { isAdmin: true } })
  const c1 = classifyDeterministic(r1, DEFAULT_CONFIG)
  const p1 = resolvePlan(r1, c1, DEFAULT_CONFIG, registry())
  assert.equal(p1.primary, 'openai')

  const r2 = req({ taskType: 'planning', message: 'Design architecture.', providerOverride: 'openai', userContext: { isAdmin: false } })
  const c2 = classifyDeterministic(r2, DEFAULT_CONFIG)
  const p2 = resolvePlan(r2, c2, DEFAULT_CONFIG, registry())
  assert.equal(p2.primary, 'anthropic') // override ignored
  assert.ok(p2.notes.some((n) => n.includes('ignored provider override')))
})

test('reviewer unavailable degrades to single-model with a note', () => {
  const reg = registry()
  reg.recordFailure('openai', 'x'); reg.recordFailure('openai', 'x') // open reviewer breaker
  const r = req({ taskType: 'planning', message: 'Design the architecture.' })
  const c = classifyDeterministic(r, DEFAULT_CONFIG) // level 3 parallel
  const plan = resolvePlan(r, c, DEFAULT_CONFIG, reg)
  assert.equal(plan.reviewer, null)
  assert.ok(plan.degraded)
})
