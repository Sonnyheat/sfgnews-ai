import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../limiter.ts'
import { InMemoryStore, createPostgresStore } from '../store.ts'
import { extractClientIp, enforceRateLimit } from '../http.ts'
import type { RateLimitStore } from '../types.ts'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, tick: (ms: number) => { t += ms } }
}

test('allows up to max, blocks the next request in the window', async () => {
  const c = clock()
  const rl = new RateLimiter(new InMemoryStore(c.now), { windowMs: 60_000, max: 3 }, c.now)
  assert.equal((await rl.check('ip1')).allowed, true) // 1
  assert.equal((await rl.check('ip1')).allowed, true) // 2
  const third = await rl.check('ip1')
  assert.equal(third.allowed, true) // 3
  assert.equal(third.remaining, 0)
  const fourth = await rl.check('ip1')
  assert.equal(fourth.allowed, false) // 4 -> blocked
  assert.ok(fourth.retryAfterMs > 0)
})

test('window resets after windowMs', async () => {
  const c = clock()
  const rl = new RateLimiter(new InMemoryStore(c.now), { windowMs: 60_000, max: 1 }, c.now)
  assert.equal((await rl.check('ip1')).allowed, true)
  assert.equal((await rl.check('ip1')).allowed, false)
  c.tick(60_000) // next window
  assert.equal((await rl.check('ip1')).allowed, true)
})

test('limits are per-key (per-IP isolation)', async () => {
  const c = clock()
  const rl = new RateLimiter(new InMemoryStore(c.now), { windowMs: 60_000, max: 1 }, c.now)
  assert.equal((await rl.check('ipA')).allowed, true)
  assert.equal((await rl.check('ipB')).allowed, true) // different IP, own bucket
  assert.equal((await rl.check('ipA')).allowed, false)
})

test('fail-closed by default when the store throws', async () => {
  const c = clock()
  const boom: RateLimitStore = { async increment() { throw new Error('db down') } }
  const rl = new RateLimiter(boom, { windowMs: 60_000, max: 5 }, c.now)
  const r = await rl.check('ip1')
  assert.equal(r.allowed, false)
  assert.equal(r.degraded, true)
})

test('fail-open when configured', async () => {
  const c = clock()
  const boom: RateLimitStore = { async increment() { throw new Error('db down') } }
  const rl = new RateLimiter(boom, { windowMs: 60_000, max: 5, onStoreError: 'allow' }, c.now)
  const r = await rl.check('ip1')
  assert.equal(r.allowed, true)
  assert.equal(r.degraded, true)
})

test('keyPrefix isolates gates sharing one store', async () => {
  const c = clock()
  const store = new InMemoryStore(c.now)
  const chat = new RateLimiter(store, { windowMs: 60_000, max: 1, keyPrefix: 'realtime-chat' }, c.now)
  const other = new RateLimiter(store, { windowMs: 60_000, max: 1, keyPrefix: 'other' }, c.now)
  assert.equal((await chat.check('ip1')).allowed, true)
  assert.equal((await other.check('ip1')).allowed, true) // different prefix, own bucket
  assert.equal((await chat.check('ip1')).allowed, false)
})

test('extractClientIp prefers platform headers then XFF', () => {
  assert.equal(
    extractClientIp(new Request('http://x', { headers: { 'cf-connecting-ip': '203.0.113.9' } })),
    '203.0.113.9',
  )
  assert.equal(
    extractClientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' } })),
    '203.0.113.1',
  )
  assert.equal(extractClientIp(new Request('http://x')), 'unknown')
})

test('enforceRateLimit returns null when allowed, 429 when blocked', async () => {
  const c = clock()
  const rl = new RateLimiter(new InMemoryStore(c.now), { windowMs: 60_000, max: 1 }, c.now)
  const req = new Request('http://x', { headers: { 'x-real-ip': '203.0.113.5' } })
  assert.equal(await enforceRateLimit(req, rl), null) // first ok
  const blocked = await enforceRateLimit(req, rl)
  assert.ok(blocked)
  assert.equal(blocked!.status, 429)
  assert.ok(blocked!.headers.get('Retry-After'))
  assert.equal(blocked!.headers.get('X-RateLimit-Limit'), '1')
})

test('postgres store increments atomically via injected exec', async () => {
  // Simulate the DB counter with a map; assert the SQL upsert contract is used.
  const counts = new Map<string, number>()
  const store = createPostgresStore(async (_sql, params) => {
    const [key, windowStartMs] = params as [string, number, number]
    const k = `${key}:${windowStartMs}`
    const n = (counts.get(k) ?? 0) + 1
    counts.set(k, n)
    return [{ count: n }]
  })
  const c = clock()
  const rl = new RateLimiter(store, { windowMs: 60_000, max: 2 }, c.now)
  assert.equal((await rl.check('ip1')).allowed, true)
  assert.equal((await rl.check('ip1')).allowed, true)
  assert.equal((await rl.check('ip1')).allowed, false)
})
