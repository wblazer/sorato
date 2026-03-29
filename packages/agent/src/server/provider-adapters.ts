import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai'
import { Config, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import {
  PROVIDER_DEFINITIONS,
  type ProviderId,
} from './provider-definitions.ts'

const present = (key: string) => !!process.env[key]?.trim()

const any = (keys: ReadonlyArray<string>) => keys.some(present)

type ProviderAdapter = {
  readonly available: (keys: ReadonlyArray<string>) => boolean
  readonly supportsModel: (model: string) => boolean
  readonly layer: (model: string) => unknown
}

export const PROVIDER_ADAPTERS = {
  anthropic: {
    available: any,
    supportsModel: (model: string) =>
      PROVIDER_DEFINITIONS.anthropic.supportedModels.has(model as never),
    layer: (model: string) =>
      AnthropicLanguageModel.layer({
        model: model as AnthropicLanguageModel.Model,
      }).pipe(
        Layer.provide(
          AnthropicClient.layerConfig({
            apiKey: Config.redacted('ANTHROPIC_API_KEY'),
          })
        ),
        Layer.provide(FetchHttpClient.layer)
      ),
  },
  openai: {
    available: any,
    supportsModel: (model: string) =>
      PROVIDER_DEFINITIONS.openai.supportedModels.has(model as never),
    layer: (model: string) =>
      OpenAiLanguageModel.layer({
        model: model as OpenAiLanguageModel.Model,
      }).pipe(
        Layer.provide(
          OpenAiClient.layerConfig({
            apiKey: Config.redacted('OPENAI_API_KEY'),
          })
        ),
        Layer.provide(FetchHttpClient.layer)
      ),
  },
} satisfies Record<ProviderId, ProviderAdapter>
