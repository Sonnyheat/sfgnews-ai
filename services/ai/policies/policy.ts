// Routing policy resolution.
//
// Turns a Classification into a concrete execution plan (mode + which provider
// is primary / reviewer), honoring: admin overrides, provider availability
// (circuit breakers), and DB-driven policy overrides layered over DEFAULT_CONFIG.
//
// Routing responsibilities are DATA, not hardcoded branches — administrators can
// remap primary/reviewer and per-level modes via config/DB without code changes.

import type { RouterConfig } from '../config.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import type {
  Classification,
  ExecuteRequest,
  ExecutionMode,
  ProviderName,
} from '../types.ts'

export interface ExecutionPlan {
  mode: ExecutionMode
  primary: ProviderName
  /** Present for primary_review / parallel. */
  reviewer: ProviderName | null
  /** True when we degraded the plan because a provider was unavailable. */
  degraded: boolean
  notes: string[]
}

function other(p: ProviderName): ProviderName {
  return p === 'anthropic' ? 'openai' : 'anthropic'
}

export function resolvePlan(
  req: ExecuteRequest,
  classification: Classification,
  config: RouterConfig,
  registry: ProviderRegistry,
): ExecutionPlan {
  const notes: string[] = []
  let degraded = false

  let mode: ExecutionMode = classification.recommendedExecutionMode
  let primary: ProviderName = config.defaultPrimary
  let reviewer: ProviderName | null = config.defaultReviewer

  // requiresCurrentResearch nudges the research-capable provider to primary.
  if (req.requiresCurrentResearch) {
    notes.push('requiresCurrentResearch: routing research-capable provider first')
  }

  // Admin manual overrides (only honored for authenticated admins).
  const isAdmin = !!req.userContext?.isAdmin
  if (req.executionModeOverride && isAdmin) {
    mode = req.executionModeOverride
    notes.push(`admin executionMode override -> ${mode}`)
  } else if (req.executionModeOverride && !isAdmin) {
    notes.push('ignored executionMode override (caller not admin)')
  }
  if (req.providerOverride && isAdmin) {
    primary = req.providerOverride
    reviewer = other(primary)
    notes.push(`admin provider override -> primary ${primary}`)
  } else if (req.providerOverride && !isAdmin) {
    notes.push('ignored provider override (caller not admin)')
  }

  // Single-provider modes fix the primary.
  if (mode === 'claude_only') { primary = 'anthropic'; reviewer = null }
  if (mode === 'openai_only') { primary = 'openai'; reviewer = null }

  // Availability-aware fallback. Never silently drop a required review; instead
  // degrade with a recorded note (the router still applies SHIELD/human gates).
  const primaryUp = registry.isAvailable(primary)
  if (!primaryUp) {
    const alt = other(primary)
    if (registry.isAvailable(alt)) {
      notes.push(`primary ${primary} unavailable -> failover to ${alt}`)
      primary = alt
      reviewer = reviewer ? other(primary) : null
      degraded = true
    } else {
      notes.push(`both providers unavailable for primary role`)
    }
  }

  if ((mode === 'primary_review' || mode === 'parallel') && reviewer) {
    if (!registry.isAvailable(reviewer)) {
      notes.push(
        `reviewer ${reviewer} unavailable -> proceeding single-model, escalating for human/SHIELD review`,
      )
      reviewer = null
      degraded = true
    }
  }

  return { mode, primary, reviewer, degraded, notes }
}
