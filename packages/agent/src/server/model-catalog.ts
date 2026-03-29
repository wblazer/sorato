import { Effect } from 'effect'
import { ModelError, ModelOption, ModelsResponse } from './api.ts'
import { MODEL_PROVIDERS } from './models.generated.ts'
import { PROVIDER_ADAPTERS } from './provider-adapters.ts'
import { loadRuntimeConfig } from './runtime-config.ts'

type Entry = {
  readonly id: string
  readonly name: string
  readonly provider: string
}

const entries = () =>
  MODEL_PROVIDERS.flatMap((provider) => {
    const adapter = PROVIDER_ADAPTERS[provider.id]
    if (!adapter || !adapter.available(provider.env)) return []

    return provider.models.map(
      (model) =>
        ({
          id: `${provider.id}/${model.id}`,
          name: model.name,
          provider: provider.name,
        }) satisfies Entry
    )
  })

export const listModels = Effect.fn('ModelCatalog.list')(function* (
  dir: string
) {
  const cfg = yield* loadRuntimeConfig(dir).pipe(
    Effect.mapError((error) => new ModelError({ message: error.message }))
  )

  const items = entries().map(
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
  const [provider, ...rest] = id.split('/') as [
    keyof typeof PROVIDER_ADAPTERS,
    ...Array<string>,
  ]
  const model = rest.join('/')
  const adapter = PROVIDER_ADAPTERS[provider]
  if (!adapter || !model) return
  return adapter.layer(model)
}
