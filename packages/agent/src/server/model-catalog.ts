import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { Config, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Effect } from 'effect'
import { ModelError, ModelOption, ModelsResponse } from './api.ts'
import { loadRuntimeConfig } from './runtime-config.ts'

type Entry = {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly model: AnthropicLanguageModel.Model
}

const catalog: ReadonlyArray<Entry> = [
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    model: 'claude-haiku-4-5',
  },
]

const available = () => {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return []
  return catalog
}

export const listModels = Effect.fn('ModelCatalog.list')(function* (
  dir: string
) {
  const cfg = yield* loadRuntimeConfig(dir).pipe(
    Effect.mapError((error) => new ModelError({ message: error.message }))
  )

  const models = available().map(
    (item) =>
      new ModelOption({
        id: item.id,
        name: item.name,
        provider: item.provider,
      })
  )

  const ids = new Set(models.map((item) => item.id))
  const defaultModel =
    cfg.default_model && ids.has(cfg.default_model)
      ? cfg.default_model
      : undefined

  return new ModelsResponse({
    models,
    ...(defaultModel ? { defaultModel } : {}),
  })
})

export const ensureModel = Effect.fn('ModelCatalog.ensure')(function* (
  dir: string,
  model: string
) {
  const models = yield* listModels(dir)

  if (models.models.some((item) => item.id === model)) return

  return yield* new ModelError({
    message: `Model is not available for this server: ${model}`,
  })
})

export const modelLayer = (id: string) => {
  const model = catalog.find((item) => item.id === id)
  if (!model) return

  return AnthropicLanguageModel.layer({ model: model.model }).pipe(
    Layer.provide(
      AnthropicClient.layerConfig({
        apiKey: Config.redacted('ANTHROPIC_API_KEY'),
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  )
}
