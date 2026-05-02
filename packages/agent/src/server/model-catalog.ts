import { Effect } from 'effect'
import type { RuntimeConfigError } from './runtime-config.ts'
import { ModelError, ModelOption, ModelsResponse } from './api.ts'
import { MODEL_PROVIDERS } from './models.generated.ts'
import { PROVIDER_ADAPTERS } from './provider-adapters.ts'
import { loadRuntimeConfig } from './runtime-config.ts'

type Entry = {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly releaseDate?: string
}

const compareModels = (a: Entry, b: Entry) => {
  const releaseDate = (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
  if (releaseDate !== 0) return releaseDate

  const aLatest = a.id.includes('latest') || a.name.includes('(latest)')
  const bLatest = b.id.includes('latest') || b.name.includes('(latest)')
  const latest = Number(bLatest) - Number(aLatest)
  if (latest !== 0) return latest

  return b.id.localeCompare(a.id)
}

const toEntry = (
  provider: (typeof MODEL_PROVIDERS)[number],
  model: (typeof MODEL_PROVIDERS)[number]['models'][number]
): Array<Entry> => {
  const adapter = PROVIDER_ADAPTERS[provider.id]

  if (!adapter?.available(provider.env)) return []
  if (!adapter.supportsModel(model.id)) return []

  return [
    {
      id: `${provider.id}/${model.id}`,
      name: model.name,
      provider: provider.name,
      releaseDate: model.releaseDate,
    },
  ]
}

const entries = () =>
  MODEL_PROVIDERS.flatMap((provider) =>
    provider.models.flatMap((model) => toEntry(provider, model))
  ).sort(compareModels)

const hasProviderAdapter = (
  provider: string
): provider is keyof typeof PROVIDER_ADAPTERS => provider in PROVIDER_ADAPTERS

export const listModels = Effect.fn('ModelCatalog.list')(function* (
  dir: string
) {
  const cfg = yield* loadRuntimeConfig(dir).pipe(
    Effect.mapError(
      (error: RuntimeConfigError) => new ModelError({ message: error.message })
    )
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
    (cfg.default_model && ids.has(cfg.default_model) && cfg.default_model) ||
    undefined

  return new ModelsResponse({ models: items, defaultModel })
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
  const [provider, ...rest] = id.split('/')
  const model = rest.join('/')
  if (!provider || !hasProviderAdapter(provider) || !model) return
  const adapter = PROVIDER_ADAPTERS[provider]
  return adapter.layer(model)
}
