// OpenAI adapter — Sunny's independent reasoning / structured-output / second
// opinion model.
//
// SECURITY: the API key is read from the environment at call time and is never
// logged, returned, or embedded in any result.

import type { Provider, ProviderRequest, ProviderResult } from '../types.ts'
import { defaultEnvReader, type EnvReader } from './types.ts'
import { ProviderCallError, ProviderConfigError } from './anthropic.ts'

const API_URL = 'https://api.openai.com/v1/chat/completions'

export interface OpenAiOptions {
  model: string
  apiKeyEnv?: string // default OPENAI_API_KEY
  getEnv?: EnvReader
  fetchImpl?: typeof fetch
}

export class OpenAiProvider implements Provider {
  readonly name = 'openai' as const
  readonly defaultModel: string
  private readonly apiKeyEnv: string
  private readonly getEnv: EnvReader
  private readonly fetchImpl: typeof fetch

  constructor(opts: OpenAiOptions) {
    this.defaultModel = opts.model
    this.apiKeyEnv = opts.apiKeyEnv ?? 'OPENAI_API_KEY'
    this.getEnv = opts.getEnv ?? defaultEnvReader
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async execute(req: ProviderRequest): Promise<ProviderResult> {
    const key = this.getEnv(this.apiKeyEnv)
    if (!key) {
      throw new ProviderConfigError(
        `Missing ${this.apiKeyEnv} for OpenAI provider`,
      )
    }

    const messages: Array<{ role: string; content: string }> = []
    if (req.outputSchema) {
      messages.push({
        role: 'system',
        content:
          `${req.system ?? ''}\n\nReturn ONLY a JSON object conforming to this schema:\n${JSON.stringify(req.outputSchema)}`.trim(),
      })
    } else if (req.system) {
      messages.push({ role: 'system', content: req.system })
    }
    messages.push({ role: 'user', content: req.message })

    const body: Record<string, unknown> = {
      model: this.defaultModel,
      max_tokens: req.maxOutputTokens ?? 2_000,
      temperature: req.temperature ?? 0.3,
      messages,
    }
    if (req.outputSchema) body.response_format = { type: 'json_object' }

    const started = Date.now()
    let res: Response
    try {
      res = await this.fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      })
    } catch (err) {
      throw new ProviderCallError(
        `OpenAI request failed: ${(err as Error).message}`,
      )
    }

    if (!res.ok) {
      const detail = await safeText(res)
      throw new ProviderCallError(
        `OpenAI ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
      )
    }

    const json = (await res.json()) as OpenAiResponse
    const text = (json.choices?.[0]?.message?.content ?? '').trim()

    return {
      provider: 'openai',
      model: json.model ?? this.defaultModel,
      text,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      latencyMs: Date.now() - started,
    }
  }
}

interface OpenAiResponse {
  model?: string
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
