import { Effect } from 'effect'
import { ModelError, ModelOption, ModelsResponse } from './api.ts'
import { MODEL_PROVIDERS } from './models.generated.ts'
import { PROVIDER_ADAPTERS } from './provider-adapters.ts'
import { RuntimeConfigService } from './runtime-config.ts'
import { getAuth, hasProviderAuth, ProviderAuthStore, providerApiKey } from './provider-auth.ts'

type Entry = {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly releaseDate?: string
  readonly capabilities: ModelCapabilities
}

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export type ModelOptions = {
  readonly thinkingLevel?: ThinkingLevel
  readonly mode?: string
}

type ModelCapabilities = {
  readonly attachment: boolean
  readonly reasoning: boolean
  readonly temperature: boolean
  readonly toolCall: boolean
  readonly thinkingLevels: ReadonlyArray<ThinkingLevel>
  readonly modes: ReadonlyArray<string>
  readonly limits: {
    readonly context: number
    readonly input?: number
    readonly output: number
  }
}

export type ModelSelection = ModelOptions & {
  readonly id: string
  readonly sessionId?: string
}

const thinkingLevels = (
  provider: string,
  model: (typeof MODEL_PROVIDERS)[number]['models'][number]
): ReadonlyArray<ThinkingLevel> => {
  if (!model.capabilities.reasoning) return ['off']
  if (provider === 'openai') return ['off', 'minimal', 'low', 'medium', 'high']
  if (provider === 'anthropic') return ['off', 'low', 'medium', 'high']
  return ['off']
}

const openAiOauthModels = new Set([
  'gpt-5.5',
  'gpt-5.2',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
])

const isOpenAiOauthModel = (modelId: string) => {
  if (openAiOauthModels.has(modelId)) return true
  const match = modelId.match(/^gpt-(\d+\.\d+)/)
  return match?.[1] ? Number.parseFloat(match[1]) > 5.4 : false
}

const validOptions = (
  option: ModelOption,
  selection: Omit<ModelSelection, 'id'>
) =>
  (!selection.thinkingLevel ||
    option.capabilities.thinkingLevels.includes(selection.thinkingLevel)) &&
  (!selection.mode || option.capabilities.modes.includes(selection.mode))

const compareModels = (a: Entry, b: Entry) => {
  const releaseDate = (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
  if (releaseDate !== 0) return releaseDate

  const aLatest = a.id.includes('latest') || a.name.includes('(latest)')
  const bLatest = b.id.includes('latest') || b.name.includes('(latest)')
  const latest = Number(bLatest) - Number(aLatest)
  if (latest !== 0) return latest

  return b.id.localeCompare(a.id)
}

const toEntry = Effect.fn('ModelCatalog.toEntry')(function* (
  provider: (typeof MODEL_PROVIDERS)[number],
  model: (typeof MODEL_PROVIDERS)[number]['models'][number]
) {
  const adapter = PROVIDER_ADAPTERS[provider.id]
  const apiKey = yield* providerApiKey(provider.id, provider.env)
  const stored = yield* getAuth(provider.id)
  const hasAuth = yield* hasProviderAuth(provider.id, provider.env)

  if (!adapter?.available(provider.env, apiKey) && !hasAuth) return []
  if (provider.id === 'openai' && stored?.type === 'oauth' && !isOpenAiOauthModel(model.id)) return []
  if (!adapter.supportsModel(model.id)) return []

  if (apiKey && provider.env[0]) process.env[provider.env[0]] = apiKey

  return [
    {
      id: `${provider.id}/${model.id}`,
      name: model.name,
      provider: provider.name,
      releaseDate: model.releaseDate,
      capabilities: {
        ...model.capabilities,
        thinkingLevels: thinkingLevels(provider.id, model),
      },
    },
  ]
})

const entries = Effect.fn('ModelCatalog.entries')(function* () {
  const nested = yield* Effect.all(
    MODEL_PROVIDERS.map((provider) =>
      Effect.all(provider.models.map((model) => toEntry(provider, model)))
    )
  )

  return nested.flat(2).sort(compareModels)
})

const availableEntries = () =>
  entries().pipe(
    Effect.mapError(
      (error) =>
        new ModelError({
          message:
            error instanceof Error ? error.message : 'Failed to read provider credentials',
        })
    )
  )

const hasProviderAdapter = (
  provider: string
): provider is keyof typeof PROVIDER_ADAPTERS => provider in PROVIDER_ADAPTERS

const listModelsEffect = Effect.fn('ModelCatalog.list')(function* (
  _dataDir: string,
  dir: string
) {
  yield* Effect.logDebug('Listing available models', { dir })
  const runtimeConfig = yield* RuntimeConfigService
  const cfg = yield* runtimeConfig.get(dir)

  const items = (yield* availableEntries()).map(
    (item) =>
      new ModelOption({
        id: item.id,
        name: item.name,
        provider: item.provider,
        capabilities: item.capabilities,
      })
  )

  const ids = new Set(items.map((item) => item.id))
  const defaultModel =
    (cfg.default_model && ids.has(cfg.default_model) && cfg.default_model) ||
    undefined

  yield* Effect.logInfo('Available models resolved', {
    dir,
    modelCount: items.length,
    defaultModel,
  })

  return new ModelsResponse({ models: items, defaultModel })
})

export const listModels = (dataDir: string, dir: string) =>
  listModelsEffect(dataDir, dir).pipe(
    Effect.annotateLogs({ package: 'server', subsystem: 'model-catalog' }),
    Effect.withLogSpan('server.listModels')
  )

const ensureModelEffect = Effect.fn('ModelCatalog.ensure')(function* (
  dataDir: string,
  dir: string,
  model: string,
  options: ModelOptions = {}
) {
  const models = yield* listModels(dataDir, dir)

  const option = models.models.find((item) => item.id === model)
  if (option && validOptions(option, options)) {
    yield* Effect.logDebug('Model selection accepted', { dir, model, options })
    return
  }

  yield* Effect.logWarning('Model selection rejected', { dir, model, options })

  return yield* new ModelError({
    message: `Model is not available for this server: ${model}`,
  })
})

export const ensureModel = (
  dataDir: string,
  dir: string,
  model: string,
  options: ModelOptions = {}
) =>
  ensureModelEffect(dataDir, dir, model, options).pipe(
    Effect.annotateLogs({ package: 'server', subsystem: 'model-catalog' }),
    Effect.withLogSpan('server.ensureModel')
  )

const modelLayerEffect = Effect.fn('ModelCatalog.modelLayer')(function* (
  dataDir: string,
  selection: ModelSelection
) {
  const [provider, ...rest] = selection.id.split('/')
  const model = rest.join('/')
  if (!provider || !hasProviderAdapter(provider) || !model) {
    yield* Effect.logWarning('Model layer unavailable', { selection })
    return
  }
  const adapter = PROVIDER_ADAPTERS[provider]
  const authStore = yield* ProviderAuthStore
  const auth = yield* getAuth(provider)
  const apiKey = yield* providerApiKey(provider, MODEL_PROVIDERS.find((item) => item.id === provider)?.env ?? [])
  yield* Effect.logDebug('Model layer resolved', {
    provider,
    model,
    authType: auth?.type,
    hasApiKey: apiKey !== undefined,
  })
  return adapter.layer(dataDir, { ...selection, id: model }, auth, apiKey, authStore)
})

export const modelLayer = (dataDir: string, selection: ModelSelection) =>
  modelLayerEffect(dataDir, selection).pipe(
    Effect.annotateLogs({ package: 'server', subsystem: 'model-catalog' }),
    Effect.withLogSpan('server.modelLayer')
  )
