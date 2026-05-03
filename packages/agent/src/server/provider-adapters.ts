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

const anthropicThinkingLevel = (selection: ModelSelection) => {
  if (selection.thinkingLevel === 'low') return 'low'
  if (selection.thinkingLevel === 'medium') return 'medium'
  if (selection.thinkingLevel === 'high') return 'high'
  return undefined
}

export const PROVIDER_ADAPTERS = {
  anthropic: {
    available: any,
    supportsModel: (model: string) => anthropicModels.has(model),
    layer: (selection: ModelSelection) => {
      const effort = anthropicThinkingLevel(selection)

      return AnthropicLanguageModel.layer({
        model: selection.id as AnthropicLanguageModel.Model,
        config: effort ? { output_config: { effort } } : {},
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
