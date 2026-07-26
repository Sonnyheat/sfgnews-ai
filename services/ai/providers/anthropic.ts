// Anthropic (Claude) adapter — Sunny's primary conversational / long-form model.
//
// SECURITY: the API key is read from the environment at call time and is never
// logged, returned, or embedded in any result. If the key is missing the
// adapter throws a typed error the router treats as provider-unavailable.

import type { Provider, ProviderRequest, ProviderResult } from '../types.ts'
import { defaultEnvReader, type EnvReader } from './types.ts'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

export class ProviderConfigError extends Error {}
export class ProviderCallError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export interface AnthropicOptions {
  model: string
  apiKeyEnv?: string // default ANTHROPIC_API_KEY
  getEnv?: EnvReader
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic' as const
  readonly defaultModel: string
  private readonly apiKeyEnv: string
  private readonly getEnv: EnvReader
  private readonly fetchImpl: typeof fetch

  constructor(opts: AnthropicOptions) {
    this.defaultModel = opts.model
    this.apiKeyEnv = opts.apiKeyEnv ?? 'ANTHROPIC_API_KEY'
    this.getEnv = opts.getEnv ?? defaultEnvReader
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const key = this.getEnv(this.apiKeyEnv)
    if (!key) {
      throw new ProviderConfigError(
        `Missing ${this.apiKeyEnv} for Anthropic provider`,
      )
    }

    // When a JSON schema is requested, instruct the model to emit only JSON.
    // Server-side validation + recovery lives in schema/validate.ts; we never
    // trust the model's JSON blindly.
    const system = req.outputSchema
      ? `${req.system ?? ''}\n\nRespond with ONLY a single JSON object that conforms to this JSON schema. No prose, no code fences.\nSchema:\n${JSON.stringify(req.outputSchema)}`.trim()
      : req.system

    const body = {
      model: this.defaultModel,
      max_tokens: req.maxOutputTokens ?? 2_000,
      temperature: req.temperature ?? 0.3,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: req.message }],
    }

    const started = Date.now()
    let res: Response
    try {
      res = await this.fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      })
    } catch (err) {
      throw new ProviderCallError(
        `Anthropic request failed: ${(err as Error).message}`,
      )
    }

    if (!res.ok) {
      const detail = await safeText(res)
      throw new ProviderCallError(
        `Anthropic ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
      )
    }

    const json = (await res.json()) as AnthropicResponse
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()

    return {
      provider: 'anthropic',
      model: json.model ?? this.defaultModel,
      text,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
      latencyMs: Date.now() - started,
    }
  }
}

interface AnthropicResponse {
  model?: string
  content?: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
