import test from 'node:test'
import assert from 'node:assert/strict'
import { AiRouter } from '../router/index.ts'
import { DEFAULT_CONFIG, type RouterConfig } from '../config.ts'
import { InMemoryApprovalQueue } from '../approval/queue.ts'
import { NoopLogger } from '../logging/logger.ts'
import { FakeProvider, decisionJson, fakeClock, noSleep } from './fakes.ts'
import type { ExecuteRequest } from '../types.ts'

function makeRouter(providers: FakeProvider[], config?: Partial<RouterConfig>, queue?: InMemoryApprovalQueue) {
  const clk = fakeClock()
  return new AiRouter({
    providers,
    config: { ...DEFAULT_CONFIG, ...config },
    logger: new NoopLogger(),
    approvalQueue: queue ?? new InMemoryApprovalQueue(),
    now: clk.now,
    sleep: noSleep,
    genId: () => 'req-test',
  })
}

const req = (o: Partial<ExecuteRequest>): ExecuteRequest => ({
  agent: 'alex', taskType: 'general', message: '', ...o,
})

test('routine task is released with a single final response', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: 'Here is your tightened memo.' })
  const b = new FakeProvider({ name: 'openai' })
  const router = makeRouter([a, b])
  const r = await router.execute(req({ agent: 'ops', taskType: 'email_rewrite', message: 'Rewrite this internal memo.', riskLevel: 'low' }))
  assert.equal(r.status, 'released')
  assert.equal(r.finalResponse, 'Here is your tightened memo.')
  assert.equal(r.executionMode, 'claude_only')
  assert.equal(b.calls, 0) // reviewer not used at level 1
})

test('level 4 (Alex personalized) never auto-releases — goes to human approval', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: decisionJson({ recommendedAction: 'Recommend policy A' }) })
  const b = new FakeProvider({ name: 'openai', text: decisionJson({ recommendedAction: 'Recommend policy A', provider: 'openai' }) })
  const queue = new InMemoryApprovalQueue()
  const router = makeRouter([a, b], undefined, queue)
  const r = await router.execute(req({ agent: 'alex', taskType: 'chat', message: 'Which policy should I buy for my family?' }))
  assert.equal(r.status, 'pending_human_approval')
  assert.equal(r.finalResponse.includes('licensed'), true)
  assert.ok(r.approvalId)
  assert.equal(queue.items.length, 1)
})

test('SHIELD block yields blocked status + safe fallback (writer cannot override)', async () => {
  // Primary self-declares block; SHIELD honors it.
  const a = new FakeProvider({ name: 'anthropic', text: decisionJson({ complianceStatus: 'block' }) })
  const b = new FakeProvider({ name: 'openai' })
  const router = makeRouter([a, b])
  const r = await router.execute(req({ agent: 'alex', taskType: 'customer_education', message: 'Explain final expense coverage in general.' }))
  assert.equal(r.status, 'blocked')
  assert.equal(r.shield?.decision, 'BLOCK')
})

test('parallel disagreement escalates to human review', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: decisionJson({ recommendedAction: 'Rebuild the entire lead pipeline from scratch now' }) })
  const b = new FakeProvider({ name: 'openai', text: decisionJson({ recommendedAction: 'Keep current system, add monitoring only', provider: 'openai' }) })
  const router = makeRouter([a, b])
  const r = await router.execute(req({ agent: 'atlas', taskType: 'planning', message: 'Propose the new system architecture.' }))
  assert.equal(r.executionMode, 'parallel')
  assert.ok(r.comparison)
  assert.equal(r.status, 'pending_human_approval')
})

test('parallel runs both providers independently (neither sees the other draft)', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: decisionJson({}) })
  const b = new FakeProvider({ name: 'openai', text: decisionJson({ provider: 'openai' }) })
  const router = makeRouter([a, b])
  await router.execute(req({ agent: 'atlas', taskType: 'planning', message: 'Design the architecture.' }))
  // Neither fake received the other's output in its prompt.
  assert.ok(!(a.lastRequest?.message ?? '').includes('Design the architecture') === false)
  assert.equal((a.lastRequest?.message ?? '').includes('openai'), false)
  assert.equal((b.lastRequest?.message ?? '').includes('anthropic'), false)
})

test('all providers failing returns a safe error response', async () => {
  const a = new FakeProvider({ name: 'anthropic', fail: true })
  const b = new FakeProvider({ name: 'openai', fail: true })
  const router = makeRouter([a, b])
  const r = await router.execute(req({ agent: 'atlas', taskType: 'planning', message: 'Design the architecture.' }))
  assert.equal(r.status, 'error')
  assert.ok(r.finalResponse.length > 0)
})

test('loop/runaway guard: model-call cap bounds provider invocations', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: decisionJson({}) })
  const b = new FakeProvider({ name: 'openai', text: decisionJson({ provider: 'openai' }) })
  const router = makeRouter([a, b], { limits: { ...DEFAULT_CONFIG.limits, maxModelCallsPerRequest: 1 } })
  const r = await router.execute(req({ agent: 'atlas', taskType: 'planning', message: 'Design the architecture.' }))
  assert.ok(r.metrics.providerCalls <= 1)
})

test('metrics accumulate cost + tokens', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: decisionJson({}), usage: { inputTokens: 1000, outputTokens: 500 } })
  const b = new FakeProvider({ name: 'openai', text: decisionJson({ provider: 'openai' }), usage: { inputTokens: 1000, outputTokens: 500 } })
  const router = makeRouter([a, b])
  const r = await router.execute(req({ agent: 'atlas', taskType: 'planning', message: 'Design the architecture.' }))
  assert.ok(r.metrics.totalCostUsd > 0)
  assert.ok(r.metrics.totalInputTokens >= 2000)
  assert.ok(r.metrics.providerCalls >= 2)
})

test('retry succeeds after a transient provider failure', async () => {
  const a = new FakeProvider({ name: 'anthropic', text: 'recovered', failTimes: 1 })
  const b = new FakeProvider({ name: 'openai' })
  const router = makeRouter([a, b])
  const r = await router.execute(req({ agent: 'ops', taskType: 'email_rewrite', message: 'Rewrite memo.', riskLevel: 'low' }))
  assert.equal(r.status, 'released')
  assert.equal(r.finalResponse, 'recovered')
  assert.ok(r.metrics.retries >= 1)
})
