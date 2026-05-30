import type { ProviderId } from './provider-definitions.ts'

type CatalogModel = {
  readonly id: string
  readonly name: string
  readonly releaseDate?: string
  readonly capabilities: {
    readonly attachment: boolean
    readonly reasoning: boolean
    readonly temperature: boolean
    readonly toolCall: boolean
    readonly limits: {
      readonly context: number
      readonly input?: number
      readonly output: number
    }
    readonly modes: ReadonlyArray<string>
  }
}

type ProviderCatalogOverride = {
  readonly add?: ReadonlyArray<CatalogModel>
}

export const MODEL_CATALOG_OVERRIDES: Partial<
  Record<ProviderId, ProviderCatalogOverride>
> = {
  anthropic: {},
  openai: {},
}
