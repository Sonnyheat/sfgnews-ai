import test from 'node:test'
import assert from 'node:assert/strict'
import { CircuitBreaker } from '../router/circuitBreaker.ts'
import {
  CostLedger,
  InMemorySessionSpend,
  estimateCostUsd,
  BudgetExceededError,
  CallCapExceededError,
} from '../router/costLedger.ts'
import { fakeClock } from './fakes.ts'

test('breaker opens after threshold, half-opens after cooldown, closes on success', () => {
  const clk = fakeClock()
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: clk.now })
  assert.ok(b.canRequest())
  b.recordFailure('e'); b.recordFailure('e'); b.recordFailure('e')
  assert.equal(b.snapshot().state, 'open')
  assert.equal(b.canRequest(), false) // still within cooldown
  clk.tick(1000)
  assert.ok(b.canRequest()) // half-open probe allowed
  assert.equal(b.snapshot().state, 'half_open')
  b.recordSuccess(5)
  assert.equal(b.snapshot().state, 'closed')
})

test('breaker re-opens if half-open probe fails', () => {
  const clk = fakeClock()
  const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 500, now: clk.now })
  b.recordFailure('e')
  assert.equal(b.snapshot().state, 'open')
  clk.tick(500)
  assert.ok(b.canRequest())
  b.recordFailure('again')
  assert.equal(b.snapshot().state, 'open')
})

test('estimateCostUsd computes token cost', () => {
  const cost = estimateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    { provider: 'openai', model: 'x', inputPer1M: 2, outputPer1M: 8 },
  )
  assert.equal(cost, 10)
})

test('CostLedger enforces per-request call cap', () => {
  const ledger = new CostLedger(
    { maxModelCallsPerRequest: 2, maxCostUsdPerRequest: 100, maxCostUsdPerSession: 100 },
    'sess', new InMemorySessionSpend(),
  )
  ledger.reserve(); ledger.recordCost(0.01)
  ledger.reserve(); ledger.recordCost(0.01)
  assert.throws(() => ledger.reserve(), CallCapExceededError)
})

test('CostLedger enforces per-request budget', () => {
  const ledger = new CostLedger(
    { maxModelCallsPerRequest: 99, maxCostUsdPerRequest: 0.05, maxCostUsdPerSession: 100 },
    'sess', new InMemorySessionSpend(),
  )
  ledger.reserve(); ledger.recordCost(0.05)
  assert.throws(() => ledger.reserve(), BudgetExceededError)
})

test('CostLedger enforces per-session budget across ledgers', () => {
  const store = new InMemorySessionSpend()
  const l1 = new CostLedger({ maxModelCallsPerRequest: 99, maxCostUsdPerRequest: 100, maxCostUsdPerSession: 0.03 }, 's', store)
  l1.reserve(); l1.recordCost(0.03)
  const l2 = new CostLedger({ maxModelCallsPerRequest: 99, maxCostUsdPerRequest: 100, maxCostUsdPerSession: 0.03 }, 's', store)
  assert.throws(() => l2.reserve(), BudgetExceededError)
})
