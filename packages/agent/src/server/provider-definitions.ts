type ProviderDefinition = {
  readonly id: string
}

const defineProvider = <const Id extends string>(
  id: Id
): ProviderDefinition & { readonly id: Id } => ({ id })

export const PROVIDER_DEFINITIONS = {
  anthropic: defineProvider('anthropic'),
  openai: defineProvider('openai'),
} as const

export type ProviderId = keyof typeof PROVIDER_DEFINITIONS

export const SUPPORTED_PROVIDERS = Object.values(PROVIDER_DEFINITIONS)
