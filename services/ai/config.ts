// Default routing/policy configuration.
//
// IMPORTANT: these are DEFAULTS. In production they are overlaid by records
// from the REBUILD Supabase project (alex_operational_routing_rules,
// advisor_confidence_rules, prompt_versions, etc.). Nothing here is hardcoded
// so rigidly that an administrator cannot change it — see policies/policy.ts,
// which merges DB overrides on top of this object.

import type {
  ExecutionMode,
  ProviderName,
  RiskLevel,
} from './types.ts'

export interface ModelConfig {
  provider: ProviderName
  model: string
  /** USD per 1M input / output tokens — used for cost estimation only. */
  inputPer1M: number
  outputPer1M: number
}

export interface RouterConfig {
  /** Prompt/version tag stamped into every decision record for auditability. */
  promptVersion: string

  /** Which provider is primary for conversational/long-form work by default. */
  defaultPrimary: ProviderName
  /** Which provider gives the independent second opinion by default. */
  defaultReviewer: ProviderName

  models: Record<ProviderName, ModelConfig>

  timeouts: {
    perCallMs: number
    totalMs: number
  }

  retries: {
    /** Max retry attempts per provider call (excludes the first try). */
    maxPerCall: number
    baseDelayMs: number
  }

  /** Hard ceilings that prevent runaway usage and model-to-model loops. */
  limits: {
    /** Absolute cap on provider invocations for a single execute() call. */
    maxModelCallsPerRequest: number
    /** Per-request spend ceiling (USD). Exceeding it aborts further calls. */
    maxCostUsdPerRequest: number
    /** Per-session spend ceiling (USD) across a rolling window. */
    maxCostUsdPerSession: number
    /** Cap on output tokens requested from any single provider call. */
    maxOutputTokens: number
  }

  circuitBreaker: {
    /** Consecutive failures before the breaker opens. */
    failureThreshold: number
    /** How long the breaker stays open before a half-open probe (ms). */
    cooldownMs: number
  }

  /** Default execution mode per decision level (overridable per agent/task). */
  executionModeByLevel: Record<1 | 2 | 3 | 4, ExecutionMode>

  /** Risk hint -> minimum decision level floor. */
  riskFloor: Record<RiskLevel, 1 | 2 | 3 | 4>
}

export const DEFAULT_CONFIG: RouterConfig = {
  promptVersion: 'router-v1.2026.07',

  // Claude stays primary for conversational + long-form unless a policy or the
  // classifier says otherwise (see MODEL RESPONSIBILITIES in the spec).
  defaultPrimary: 'anthropic',
  defaultReviewer: 'openai',

  models: {
    anthropic: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5', // primary conversational model
      inputPer1M: 3,
      outputPer1M: 15,
    },
    openai: {
      provider: 'openai',
      model: 'gpt-4.1', // structured reasoning / second opinion
      inputPer1M: 2,
      outputPer1M: 8,
    },
  },

  timeouts: {
    perCallMs: 30_000,
    totalMs: 75_000,
  },

  retries: {
    maxPerCall: 2,
    baseDelayMs: 400,
  },

  limits: {
    // At most: primary + reviewer + one bounded comparison call = 3.
    // The cap is the loop-prevention backstop; normal paths use fewer.
    maxModelCallsPerRequest: 4,
    maxCostUsdPerRequest: 0.75,
    maxCostUsdPerSession: 5,
    maxOutputTokens: 4_000,
  },

  circuitBreaker: {
    failureThreshold: 4,
    cooldownMs: 30_000,
  },

  executionModeByLevel: {
    1: 'claude_only',
    2: 'primary_review',
    3: 'parallel',
    4: 'parallel', // Level 4 still analyzes with both, but never auto-releases.
  },

  riskFloor: {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  },
}
