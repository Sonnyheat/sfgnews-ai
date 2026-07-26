// Server-side structured-output validation with safe recovery.
//
// Model JSON is never trusted. We (1) robustly extract a JSON object from the
// raw text (handling code fences / leading prose), (2) validate it against a
// minimal JSON schema, and (3) for the canonical DecisionOutput, coerce/repair
// missing-but-recoverable fields rather than throwing. Callers get a typed
// result they can branch on.

import type {
  DecisionOutput,
  JsonSchema,
  ComplianceStatus,
} from '../types.ts'

export interface ValidationResult<T> {
  ok: boolean
  value: T | null
  errors: string[]
  /** True when we repaired/defaulted fields to produce a usable value. */
  recovered: boolean
}

/** Pull the first balanced JSON object out of arbitrary model text. */
export function extractJson(text: string): unknown {
  if (!text) return null
  const trimmed = text.trim()
  // Strip a leading ```json / ``` fence if present.
  const fenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const candidate = fenced || trimmed

  // Fast path: whole string is JSON.
  try {
    return JSON.parse(candidate)
  } catch {
    // fall through to brace scan
  }

  const start = candidate.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** Minimal structural validation against a JsonSchema subset. */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = '$',
): string[] {
  const errors: string[] = []
  const t = schema.type
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object`)
      return errors
    }
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: required`)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`))
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`)
      return errors
    }
    if (schema.items) {
      value.forEach((v, i) =>
        errors.push(...validateAgainstSchema(v, schema.items!, `${path}[${i}]`)),
      )
    }
  } else if (t === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: expected string`)
  } else if (t === 'number' || t === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path}: expected number`)
    else {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: < minimum`)
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: > maximum`)
    }
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`)
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(`${path}: not in enum`)
  }
  return errors
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function asComplianceStatus(v: unknown): ComplianceStatus {
  return v === 'pass' || v === 'review' || v === 'block' ? v : 'review'
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/**
 * Validate + repair the canonical DecisionOutput. Recovers what it safely can;
 * if the core recommendation/summary is unusable, returns ok:false so the
 * router falls back rather than releasing garbage.
 */
export function validateDecisionOutput(
  rawText: string,
  ctx: { provider: string; model: string; promptVersion: string },
): ValidationResult<DecisionOutput> {
  const parsed = extractJson(rawText)
  const errors: string[] = []
  let recovered = false

  if (parsed === null || typeof parsed !== 'object') {
    return {
      ok: false,
      value: null,
      errors: ['could not parse a JSON object from model output'],
      recovered: false,
    }
  }
  const o = parsed as Record<string, unknown>

  const recommendedAction =
    typeof o.recommendedAction === 'string' ? o.recommendedAction.trim() : ''
  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''

  if (!recommendedAction && !summary) {
    return {
      ok: false,
      value: null,
      errors: ['missing both recommendedAction and summary'],
      recovered: false,
    }
  }

  // Track which optional fields we defaulted.
  for (const f of ['businessBenefit', 'risks', 'assumptions', 'evidence', 'alternatives', 'missingInformation']) {
    if (!Array.isArray(o[f])) { errors.push(`${f}: defaulted to []`); recovered = true }
  }
  if (typeof o.confidence !== 'number') { errors.push('confidence: defaulted'); recovered = true }
  if (!['pass', 'review', 'block'].includes(o.complianceStatus as string)) {
    errors.push('complianceStatus: defaulted to review'); recovered = true
  }

  const value: DecisionOutput = {
    recommendedAction: recommendedAction || summary,
    summary: summary || recommendedAction,
    businessBenefit: asStringArray(o.businessBenefit),
    risks: asStringArray(o.risks),
    assumptions: asStringArray(o.assumptions),
    evidence: asStringArray(o.evidence),
    alternatives: asStringArray(o.alternatives),
    confidence: clamp01(o.confidence),
    complianceStatus: asComplianceStatus(o.complianceStatus),
    humanApprovalRequired: o.humanApprovalRequired === true,
    missingInformation: asStringArray(o.missingInformation),
    provider: ctx.provider,
    model: ctx.model,
    promptVersion: ctx.promptVersion,
  }

  return { ok: true, value, errors, recovered }
}
