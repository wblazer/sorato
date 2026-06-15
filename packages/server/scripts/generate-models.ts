import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_CATALOG_OVERRIDES } from '../src/model-catalog-overrides.ts'
import { SUPPORTED_PROVIDERS } from '../src/provider-definitions.ts'

type ModelsDevCost = {
  readonly input?: number
  readonly output?: number
  readonly cache_read?: number
  readonly cache_write?: number
  readonly tiers?: ReadonlyArray<
    ModelsDevCost & {
      readonly tier: {
        readonly type: string
        readonly size: number
      }
    }
  >
  readonly context_over_200k?: ModelsDevCost
}

type ModelsDevReasoningOption =
  | { readonly type: 'effort'; readonly values: ReadonlyArray<string> }
  | {
      readonly type: 'budget_tokens'
      readonly min?: number
      readonly max?: number
    }
  | { readonly type: 'toggle' }

type ModelsDevModel = {
  readonly id: string
  readonly name: string
  readonly release_date?: string
  readonly attachment: boolean
  readonly reasoning: boolean
  readonly reasoning_options?: ReadonlyArray<ModelsDevReasoningOption>
  readonly temperature: boolean
  readonly tool_call: boolean
  readonly limit: {
    readonly context: number
    readonly input?: number
    readonly output: number
  }
  readonly cost?: ModelsDevCost
  readonly experimental?: {
    readonly modes?: Record<string, unknown>
  }
  readonly status?: 'alpha' | 'beta' | 'deprecated'
}

type ModelsDevProvider = {
  readonly id: string
  readonly name: string
  readonly env: ReadonlyArray<string>
  readonly models: Record<string, ModelsDevModel>
}

type ModelsDevResponse = Record<string, ModelsDevProvider>

type CatalogCost = {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly tiers?: ReadonlyArray<
    CatalogCost & {
      readonly tier: {
        readonly type: string
        readonly size: number
      }
    }
  >
  readonly contextOver200K?: CatalogCost
}

// Normalized per-model reasoning control sourced from models.dev. `effort`
// carries the discrete enum; `budget` a token range; `toggle` an on/off knob.
type CatalogReasoningOption =
  | { readonly type: 'effort'; readonly values: ReadonlyArray<string> }
  | {
      readonly type: 'budget'
      readonly min: number
      readonly max: number | undefined
    }
  | { readonly type: 'toggle' }

type CatalogModel = {
  readonly id: string
  readonly name: string
  readonly releaseDate: string | undefined
  readonly cost: CatalogCost | undefined
  readonly capabilities: {
    readonly attachment: boolean
    readonly reasoning: boolean
    readonly reasoningOptions: ReadonlyArray<CatalogReasoningOption>
    readonly temperature: boolean
    readonly toolCall: boolean
    readonly limits: {
      readonly context: number
      readonly input: number | undefined
      readonly output: number
    }
    readonly modes: ReadonlyArray<string>
  }
}

const toReasoningOptions = (
  options: ReadonlyArray<ModelsDevReasoningOption> | undefined
): ReadonlyArray<CatalogReasoningOption> =>
  (options ?? []).map((option) => {
    if (option.type === 'effort') {
      return { type: 'effort', values: option.values }
    }
    if (option.type === 'budget_tokens') {
      return { type: 'budget', min: option.min ?? 0, max: option.max }
    }
    return { type: 'toggle' }
  })

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'src', 'models.generated.ts')

const response = await fetch('https://models.dev/api.json')
if (!response.ok) {
  throw new Error(`Failed to fetch models.dev catalog: ${response.status}`)
}

const data = (await response.json()) as ModelsDevResponse

const toCatalogCost = (
  cost: ModelsDevCost | undefined
): CatalogCost | undefined => {
  if (!cost) return undefined

  return {
    ...(cost.input !== undefined ? { input: cost.input } : {}),
    ...(cost.output !== undefined ? { output: cost.output } : {}),
    ...(cost.cache_read !== undefined ? { cacheRead: cost.cache_read } : {}),
    ...(cost.cache_write !== undefined ? { cacheWrite: cost.cache_write } : {}),
    ...(cost.tiers !== undefined
      ? {
          tiers: cost.tiers.map((tier) => ({
            ...toCatalogCost(tier),
            tier: tier.tier,
          })),
        }
      : {}),
    ...(cost.context_over_200k !== undefined
      ? {
          contextOver200K: toCatalogCost(cost.context_over_200k) as CatalogCost,
        }
      : {}),
  }
}

const toCatalogModel = ([id, model]: [
  string,
  ModelsDevModel,
]): CatalogModel => {
  if (model.id !== id) {
    throw new Error(`Model id mismatch: ${id}: ${model.id}`)
  }

  return {
    id,
    name: model.name,
    releaseDate: model.release_date,
    cost: toCatalogCost(model.cost),
    capabilities: {
      attachment: model.attachment,
      reasoning: model.reasoning,
      reasoningOptions: toReasoningOptions(model.reasoning_options),
      temperature: model.temperature,
      toolCall: model.tool_call,
      limits: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      modes: Object.keys(model.experimental?.modes ?? {}).sort(),
    },
  }
}

const catalog = SUPPORTED_PROVIDERS.map((provider) => {
  const source = data[provider.id]
  if (!source) {
    throw new Error(`Provider missing from models.dev catalog: ${provider.id}`)
  }
  if (source.id !== provider.id) {
    throw new Error(`Provider id mismatch for ${provider.id}: ${source.id}`)
  }

  const models = Object.entries(source.models)
    .filter(([, model]) => model.tool_call === true)
    .filter(([, model]) => model.status !== 'deprecated')
    .map(toCatalogModel)

  const existing = new Set(models.map((model) => model.id))
  const overrides = MODEL_CATALOG_OVERRIDES[provider.id]?.add ?? []

  return {
    id: source.id,
    name: source.name,
    env: source.env,
    models: [
      ...models,
      ...overrides.filter((model) => !existing.has(model.id)),
    ],
  }
})

const content = `// This file is auto-generated by scripts/generate-models.ts
// Do not edit manually - run 'bun run generate-models' to update

export const MODEL_PROVIDERS = ${JSON.stringify(catalog, null, 2)} as const
`

await writeFile(out, content)
console.log(
  `Wrote ${catalog.reduce((sum, provider) => sum + provider.models.length, 0)} models across ${catalog.length} providers to ${out}`
)
