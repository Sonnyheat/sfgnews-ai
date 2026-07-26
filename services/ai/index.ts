// Sunny Financial Group — Multi-Model Decision Architecture
// Public entrypoint. Business logic imports ONLY from here.
//
//   import { createAiRouter, AnthropicProvider, OpenAiProvider } from 'services/ai'
//
//   const router = createAiRouter({
//     providers: [
//       new AnthropicProvider({ model: 'claude-sonnet-4-5' }),
//       new OpenAiProvider({ model: 'gpt-4.1' }),
//     ],
//   })
//   const result = await router.execute({
//     agent: 'alex', taskType: 'customer_education', message,
//     userContext, retrievedContext,
//   })
//   // result.finalResponse is the single response to show the user.

export { createAiRouter, AiRouter } from './router/index.ts'
export type { AiRouterOptions } from './router/index.ts'

export { AnthropicProvider } from './providers/anthropic.ts'
export { OpenAiProvider } from './providers/openai.ts'
export { ProviderRegistry } from './providers/registry.ts'
export { ProviderConfigError, ProviderCallError } from './providers/anthropic.ts'

export { DEFAULT_CONFIG } from './config.ts'
export type { RouterConfig, ModelConfig } from './config.ts'

export {
  classify,
  classifyDeterministic,
  mergeSupplemental,
} from './classification/classifier.ts'
export type { SupplementalClassifier } from './classification/classifier.ts'
export { RULES } from './classification/rules.ts'

export { compareDecisions, textSimilarity } from './comparison/compare.ts'
export { RuleBasedShield } from './compliance/shield.ts'
export type { ShieldReviewer } from './compliance/shield.ts'

export {
  validateDecisionOutput,
  validateAgainstSchema,
  extractJson,
} from './schema/validate.ts'

export { ConsoleLogger, NoopLogger } from './logging/logger.ts'
export type { DecisionLogger, DecisionRecord } from './logging/logger.ts'

export { InMemoryApprovalQueue } from './approval/queue.ts'
export type { HumanApprovalQueue, ApprovalItem } from './approval/queue.ts'

export {
  CostLedger,
  estimateCostUsd,
  InMemorySessionSpend,
} from './router/costLedger.ts'
export { CircuitBreaker } from './router/circuitBreaker.ts'

export {
  SUNNY_RULES,
  DECISION_OUTPUT_SCHEMA,
  buildSystemPrompt,
} from './knowledge/prompt.ts'

export * from './types.ts'
