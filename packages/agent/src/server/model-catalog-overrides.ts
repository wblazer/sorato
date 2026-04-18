import type { ProviderId } from './provider-definitions.ts'

type CatalogModel = {
  readonly id: string
  readonly name: string
}

type ProviderCatalogOverride = {
  readonly add?: ReadonlyArray<CatalogModel>
}

export const MODEL_CATALOG_OVERRIDES = {
  anthropic: {},
  openai: {},
} satisfies Partial<Record<ProviderId, ProviderCatalogOverride>>
