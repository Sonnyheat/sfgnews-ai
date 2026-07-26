// Provider adapter surface + health model.
//
// Adapters are the ONLY place that knows a provider's wire format. Add a new
// provider by implementing `Provider` (services/ai/types.ts) and registering
// it — the router never changes.

import type { ProviderName } from '../types.ts'

export type BreakerState = 'closed' | 'open' | 'half_open'

export interface ProviderHealth {
  provider: ProviderName
  state: BreakerState
  /** True when the breaker permits calls right now. */
  available: boolean
  consecutiveFailures: number
  lastError?: string | null
  lastLatencyMs?: number | null
  /** epoch ms of the last state change. */
  updatedAt: number
}

/** Reads a secret from the runtime environment. Never returns/prints the value elsewhere. */
export type EnvReader = (key: string) => string | undefined

/** Default env reader that works in both Deno and Node without leaking values. */
export const defaultEnvReader: EnvReader = (key: string): string | undefined => {
  // Deno
  const g = globalThis as unknown as {
    Deno?: { env?: { get(k: string): string | undefined } }
    process?: { env?: Record<string, string | undefined> }
  }
  if (g.Deno?.env?.get) return g.Deno.env.get(key)
  if (g.process?.env) return g.process.env[key]
  return undefined
}
