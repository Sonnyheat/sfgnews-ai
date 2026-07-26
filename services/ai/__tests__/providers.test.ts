import test from 'node:test'
import assert from 'node:assert/strict'
import { AnthropicProvider, ProviderConfigError } from '../providers/anthropic.ts'
import { OpenAiProvider } from '../providers/openai.ts'
import { redactProviderResults } from '../logging/logger.ts'

// Adapters must read the key from env at call time and never surface it.

test('Anthropic adapter throws typed error when key is missing (never a silent leak)', async () => {
  const p = new AnthropicProvider({ model: 'claude', getEnv: () => undefined })
  await assert.rejects(() => p.execute({ message: 'hi' }), ProviderConfigError)
})

test('Anthropic adapter sends key in x-api-key header, not in the result', async () => {
  let capturedHeaders: Record<string, string> = {}
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    capturedHeaders = init.headers as Record<string, string>
    return new Response(
      JSON.stringify({ model: 'claude', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 3, output_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  const p = new AnthropicProvider({ model: 'claude', getEnv: () => 'SECRET_KEY_VALUE', fetchImpl: fakeFetch })
  const res = await p.execute({ message: 'hi' })
  assert.equal(capturedHeaders['x-api-key'], 'SECRET_KEY_VALUE')
  assert.equal(res.text, 'ok')
  // The secret must not appear anywhere in the serialized result.
  assert.equal(JSON.stringify(res).includes('SECRET_KEY_VALUE'), false)
})

test('OpenAI adapter sets json response_format when schema requested', async () => {
  let capturedBody: Record<string, unknown> = {}
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string)
    return new Response(
      JSON.stringify({ model: 'gpt', choices: [{ message: { content: '{"recommendedAction":"x","summary":"y","confidence":0.5,"complianceStatus":"pass"}' } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  const p = new OpenAiProvider({ model: 'gpt', getEnv: () => 'K', fetchImpl: fakeFetch })
  await p.execute({ message: 'hi', outputSchema: { type: 'object' } })
  assert.deepEqual(capturedBody.response_format, { type: 'json_object' })
})

test('redactProviderResults strips full text, keeps a short preview', () => {
  const red = redactProviderResults([
    { provider: 'anthropic', model: 'm', text: 'x'.repeat(1000), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 },
  ])
  assert.ok(red[0].textPreview.length <= 240)
  assert.equal('text' in red[0], false)
})
