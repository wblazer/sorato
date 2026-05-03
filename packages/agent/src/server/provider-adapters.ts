import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai'
import { Config, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { MODEL_PROVIDERS } from './models.generated.ts'
import type { ModelSelection } from './model-catalog.ts'
import type { ProviderId } from './provider-definitions.ts'

const present = (key: string) => !!process.env[key]?.trim()

const any = (keys: ReadonlyArray<string>) => keys.some(present)

type ProviderAdapter = {
  readonly available: (keys: ReadonlyArray<string>) => boolean
  readonly supportsModel: (model: string) => boolean
  readonly layer: (selection: ModelSelection) => unknown
}

const modelIds = (provider: ProviderId): ReadonlySet<string> =>
  new Set<string>(
    MODEL_PROVIDERS.find((item) => item.id === provider)?.models.map(
      (model) => model.id
    ) ?? []
  )

const anthropicModels = modelIds('anthropic')
const openAiModels = modelIds('openai')

const supportsAnthropicAdaptiveThinking = (modelId: string) =>
  modelId.includes('claude-sonnet-4-6') ||
  modelId.includes('claude-opus-4-6') ||
  modelId.includes('claude-opus-4-7')

const anthropicAdaptiveEffort = (selection: ModelSelection) => {
  if (selection.thinkingLevel === 'low') return 'low' as const
  if (selection.thinkingLevel === 'medium') return 'medium' as const
  if (selection.thinkingLevel === 'high') return 'high' as const
  return undefined
}

const anthropicOutputLimit = (modelId: string) =>
  MODEL_PROVIDERS.find((item) => item.id === 'anthropic')?.models.find(
    (model) => model.id === modelId
  )?.capabilities.limits.output ?? 4096

const anthropicThinkingBudget = (selection: ModelSelection) => {
  if (selection.thinkingLevel === 'minimal') return 1024
  if (selection.thinkingLevel === 'low') return 2048
  if (selection.thinkingLevel === 'medium') return 8192
  if (selection.thinkingLevel === 'high') return 16384
  if (selection.thinkingLevel === 'xhigh') return 31999
  return undefined
}

const anthropicThinkingConfig = (selection: ModelSelection) => {
  const effort = anthropicAdaptiveEffort(selection)
  if (effort && supportsAnthropicAdaptiveThinking(selection.id)) {
    return {
      thinking: { type: 'adaptive' as const },
      output_config: { effort },
    }
  }

  const targetBudget = anthropicThinkingBudget(selection)
  if (!targetBudget) return {}

  const outputLimit = anthropicOutputLimit(selection.id)
  const budgetTokens = Math.min(targetBudget, outputLimit - 1024)
  if (budgetTokens < 1024) return {}

  return {
    max_tokens: Math.min(outputLimit, budgetTokens + 4096),
    thinking: { type: 'enabled' as const, budget_tokens: budgetTokens },
  }
}

export const PROVIDER_ADAPTERS = {
  anthropic: {
    available: any,
    supportsModel: (model: string) => anthropicModels.has(model),
    layer: (selection: ModelSelection) => {
      return AnthropicLanguageModel.layer({
        model: selection.id as AnthropicLanguageModel.Model,
        config: anthropicThinkingConfig(selection),
      }).pipe(
        Layer.provide(
          AnthropicClient.layerConfig({
            apiKey: Config.redacted('ANTHROPIC_API_KEY'),
          })
        ),
        Layer.provide(FetchHttpClient.layer)
      )
    },
  },
  openai: {
    available: any,
    supportsModel: (model: string) => openAiModels.has(model),
    layer: (selection: ModelSelection) => {
      const reasoning =
        selection.thinkingLevel && selection.thinkingLevel !== 'off'
          ? {
              reasoning: {
                effort: selection.thinkingLevel,
                summary: 'auto' as const,
              },
            }
          : {}
      const serviceTier =
        selection.mode === 'fast' ? { service_tier: 'flex' as const } : {}

      return OpenAiLanguageModel.layer({
        model: selection.id as OpenAiLanguageModel.Model,
        config: { ...reasoning, ...serviceTier },
      }).pipe(
        Layer.provide(
          OpenAiClient.layerConfig({
            apiKey: Config.redacted('OPENAI_API_KEY'),
          })
        ),
        Layer.provide(FetchHttpClient.layer)
      )
    },
  },
} satisfies Record<ProviderId, ProviderAdapter>
