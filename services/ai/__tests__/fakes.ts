// Test doubles: deterministic fake providers + helpers. Not a test file.

import type {
  DecisionOutput,
  Provider,
  ProviderName,
  ProviderRequest,
  ProviderResult,
} from '../types.ts'

export function decisionJson(overrides: Partial<DecisionOutput> = {}): string {
  const base: DecisionOutput = {
    recommendedAction: 'Proceed with the proposed approach',
    summary: 'A clear, compliant general-education summary.',
    businessBenefit: ['clarity'],
    risks: ['none material'],
    assumptions: ['inputs are accurate'],
    evidence: ['policy doc v1'],
    alternatives: ['do nothing'],
    confidence: 0.8,
    complianceStatus: 'pass',
    humanApprovalRequired: false,
    missingInformation: [],
    provider: 'anthropic',
    model: 'x',
    promptVersion: 'x',
    ...overrides,
  }
  return JSON.stringify(base)
}

export interface FakeOptions {
  name: ProviderName
  /** Return this text, or compute from the request. */
  text?: string | ((req: ProviderRequest) => string)
  /** Throw to simulate provider failure. */
  fail?: boolean
  failTimes?: number // fail the first N calls then succeed
  usage?: { inputTokens: number; outputTokens: number }
  latencyMs?: number
}

export class FakeProvider implements Provider {
  readonly name: ProviderName
  readonly defaultModel = 'fake-model'
  calls = 0
  lastRequest: ProviderRequest | null = null
  private readonly opts: FakeOptions

  constructor(opts: FakeOptions) {
    this.name = opts.name
    this.opts = opts
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(req: ProviderRequest): Promise<ProviderResult> {
    this.calls++
    this.lastRequest = req
    const shouldFail =
      this.opts.fail ||
      (this.opts.failTimes !== undefined && this.calls <= this.opts.failTimes)
    if (shouldFail) throw new Error(`${this.name} simulated failure`)
    const text =
      typeof this.opts.text === 'function'
        ? this.opts.text(req)
        : this.opts.text ?? decisionJson({ provider: this.name })
    return {
      provider: this.name,
      model: this.defaultModel,
      text,
      usage: this.opts.usage ?? { inputTokens: 100, outputTokens: 50 },
      latencyMs: this.opts.latencyMs ?? 5,
    }
  }
}

/** Monotonic fake clock. */
export function fakeClock(start = 1_000): { now: () => number; tick: (ms: number) => void } {
  let t = start
  return { now: () => t, tick: (ms: number) => { t += ms } }
}

export const noSleep = async (): Promise<void> => {}
