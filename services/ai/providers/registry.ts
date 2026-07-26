// Provider registry + health surface.
//
// Holds the live Provider instances and one CircuitBreaker each. The router
// asks the registry which providers are currently callable and reports
// success/failure back so health stays current.

import type { Provider, ProviderName } from '../types.ts'
import { CircuitBreaker } from '../router/circuitBreaker.ts'
import type { ProviderHealth } from './types.ts'

export interface RegistryOptions {
  failureThreshold: number
  cooldownMs: number
  now?: () => number
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderName, Provider>()
  private readonly breakers = new Map<ProviderName, CircuitBreaker>()
  private readonly opts: RegistryOptions

  constructor(providers: Provider[], opts: RegistryOptions) {
    this.opts = opts
    for (const p of providers) this.register(p)
  }

  register(provider: Provider): void {
    this.providers.set(provider.name, provider)
    this.breakers.set(
      provider.name,
      new CircuitBreaker({
        failureThreshold: this.opts.failureThreshold,
        cooldownMs: this.opts.cooldownMs,
        now: this.opts.now,
      }),
    )
  }

  has(name: ProviderName): boolean {
    return this.providers.has(name)
  }

  get(name: ProviderName): Provider | undefined {
    return this.providers.get(name)
  }

  /** Provider is present AND its breaker currently admits a call. */
  isAvailable(name: ProviderName): boolean {
    const b = this.breakers.get(name)
    return !!b && this.providers.has(name) && b.canRequest()
  }

  recordSuccess(name: ProviderName, latencyMs: number): void {
    this.breakers.get(name)?.recordSuccess(latencyMs)
  }

  recordFailure(name: ProviderName, error: string): void {
    this.breakers.get(name)?.recordFailure(error)
  }

  /** Health snapshot for the whole fleet (for dashboards / provider status). */
  health(): ProviderHealth[] {
    const out: ProviderHealth[] = []
    for (const [name, breaker] of this.breakers) {
      const s = breaker.snapshot()
      out.push({
        provider: name,
        state: s.state,
        available: s.available && this.providers.has(name),
        consecutiveFailures: s.consecutiveFailures,
        lastError: s.lastError,
        lastLatencyMs: s.lastLatencyMs,
        updatedAt: s.updatedAt,
      })
    }
    return out
  }
}
