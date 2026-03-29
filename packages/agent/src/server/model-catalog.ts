import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { Config, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Effect } from 'effect'
import { ANTHROPIC_MODELS } from './models.generated.ts'
import { ModelError, ModelOption, ModelsResponse } from './api.ts'
import { loadRuntimeConfig } from './runtime-config.ts'

type Entry = {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly model: AnthropicLanguageModel.Model
}

const provider = 'Anthropic'

const entries: ReadonlyArray<Entry> = ANTHROPIC_MODELS.map((item) => ({
  id: `anthropic/${item.id}`,
  name: item.name,
  provider,
  model: item.id as AnthropicLanguageModel.Model,
}))

export const listModels = Effect.fn('ModelCatalog.list')(function* (
  dir: string
) {
  const cfg = yield* loadRuntimeConfig(dir).pipe(
    Effect.mapError((error) => new ModelError({ message: error.message }))
  )

  const models = process.env.ANTHROPIC_API_KEY?.trim() ? entries : []

  const items = models.map(
    (item) =>
      new ModelOption({
        id: item.id,
        name: item.name,
        provider: item.provider,
      })
  )

  const ids = new Set(items.map((item) => item.id))
  const defaultModel =
    cfg.default_model && ids.has(cfg.default_model)
      ? cfg.default_model
      : undefined

  return new ModelsResponse({
    models: items,
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
  const model = entries.find((item) => item.id === id)?.model
  if (!model) return

  return AnthropicLanguageModel.layer({ model }).pipe(
    Layer.provide(
      AnthropicClient.layerConfig({
        apiKey: Config.redacted('ANTHROPIC_API_KEY'),
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  )
}
