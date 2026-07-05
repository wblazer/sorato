import { Context, Effect, Match, Option } from 'effect'
import {
  ModelOption,
  ModelsResponse,
  ModelUnavailable,
  ProviderCredentialsUnavailable,
  ProviderNotConfigured,
} from '@sorato/api'
import { MODEL_PROVIDERS } from './models.generated.ts'
import { PROVIDER_ADAPTERS } from './provider-adapters.ts'
import type { ProviderRetryInfo } from './providers/provider-errors.ts'
import { type ThinkingLevel, thinkingLevelsFor } from './reasoning-options.ts'
import { RuntimeConfigService } from './runtime-config.ts'
import {
  getAuth,
  hasProviderAuth,
  ProviderAuthStore,
  providerApiKey,
} from './provider-auth.ts'

type CatalogProvider = (typeof MODEL_PROVIDERS)[number]
type CatalogModel = CatalogProvider['models'][number]

export type ModelCost = NonNullable<CatalogModel['cost']>

export type ResolvedModel = {
  readonly providerId: string
  readonly modelId: string
  readonly model: CatalogModel
  readonly provider: CatalogProvider
}

type Entry = {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly releaseDate?: string
  readonly capabilities: ModelCapabilities
}

export type { ThinkingLevel }

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
  readonly onRetry?: ((info: ProviderRetryInfo) => void) | undefined
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
  return Option.fromNullishOr(match?.[1]).pipe(
    Option.match({
      onNone: () => false,
      onSome: (version) => Number.parseFloat(version) > 5.4,
    })
  )
}

export const resolveModel = (id: string): ResolvedModel | undefined => {
  const parts = id.split('/')
  const providerId = parts[0]
  if (!providerId) return undefined
  const modelId = parts.slice(1).join('/')
  const provider = MODEL_PROVIDERS.find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === modelId)
  if (!provider || !model) return undefined
  return { providerId, modelId, provider, model }
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
  if (
    provider.id === 'openai' &&
    stored?.type === 'oauth' &&
    !isOpenAiOauthModel(model.id)
  )
    return []
  if (!adapter.supportsModel(model.id)) return []

  if (apiKey && provider.env[0]) process.env[provider.env[0]] = apiKey

  return [
    {
      id: `${provider.id}/${model.id}`,
      name: model.name,
      provider: provider.name,
      releaseDate: model.releaseDate,
      capabilities: {
        attachment: model.capabilities.attachment,
        reasoning: model.capabilities.reasoning,
        temperature: model.capabilities.temperature,
        toolCall: model.capabilities.toolCall,
        modes: model.capabilities.modes,
        limits: model.capabilities.limits,
        thinkingLevels: thinkingLevelsFor(
          model.capabilities.reasoningOptions,
          model.capabilities.reasoning
        ),
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
        new ProviderCredentialsUnavailable({
          code: 'provider.credentials_unavailable',
          operation: 'Read provider credentials',
          message: providerCredentialMessage(error),
          retryable: true,
        })
    )
  )

const providerCredentialMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Failed to read provider credentials'

const listModelsEffect = Effect.fn('ModelCatalog.list')(function* (
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

  if (items.length === 0) {
    return yield* new ProviderNotConfigured({
      code: 'provider.not_configured',
      message:
        'No configured model provider is available. Connect OpenAI or Anthropic credentials, or set a supported provider environment variable.',
      retryable: false,
    })
  }

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

export const listModels = (dir: string) =>
  listModelsEffect(dir).pipe(
    Effect.annotateLogs({ package: 'server', subsystem: 'model-catalog' }),
    Effect.withLogSpan('server.listModels')
  )

const ensureModelEffect = Effect.fn('ModelCatalog.ensure')(function* (
  dir: string,
  model: string,
  options: ModelOptions = {}
) {
  const models = yield* listModels(dir)

  const option = models.models.find((item) => item.id === model)
  return yield* Match.value(
    option !== undefined && validOptions(option, options)
  ).pipe(
    Match.when(true, () =>
      Effect.logDebug('Model selection accepted', { dir, model, options })
    ),
    Match.orElse(() =>
      Effect.gen(function* () {
        yield* Effect.logWarning('Model selection rejected', {
          dir,
          model,
          options,
        })
        return yield* new ModelUnavailable({
          code: 'model.unavailable',
          model,
          message: `Model is not available for this server: ${model}`,
          retryable: false,
        })
      })
    )
  )
})

export const ensureModel = (
  dir: string,
  model: string,
  options: ModelOptions = {}
) =>
  ensureModelEffect(dir, model, options).pipe(
    Effect.annotateLogs({ package: 'server', subsystem: 'model-catalog' }),
    Effect.withLogSpan('server.ensureModel')
  )

const modelLayerEffect = Effect.fn('ModelCatalog.modelLayer')(function* (
  dataDir: string,
  selection: ModelSelection
) {
  const [provider, ...rest] = selection.id.split('/')
  const model = rest.join('/')
  const validated = Match.value(`${provider}:${Number(model.length > 0)}`).pipe(
    Match.when('anthropic:1', () => ({
      provider: 'anthropic' as const,
      model,
    })),
    Match.when('openai:1', () => ({ provider: 'openai' as const, model })),
    Match.orElse(() => undefined)
  )
  if (!validated) {
    yield* Effect.logWarning('Model layer unavailable', { selection })
    return
  }
  const { provider: validProvider, model: validModel } = validated
  const adapter = PROVIDER_ADAPTERS[validProvider]
  const authStore = yield* ProviderAuthStore
  const auth = yield* getAuth(validProvider)
  const apiKey = yield* providerApiKey(
    validProvider,
    MODEL_PROVIDERS.find((item) => item.id === validProvider)?.env ?? []
  )
  yield* Effect.logDebug('Model layer resolved', {
    provider: validProvider,
    model: validModel,
    authType: auth?.type,
    hasApiKey: apiKey !== undefined,
  })
  return adapter.layer(
    dataDir,
    { ...selection, id: validModel },
    auth,
    apiKey,
    authStore
  )
})

export const modelLayer = (dataDir: string, selection: ModelSelection) =>
  modelLayerEffect(dataDir, selection).pipe(
    Effect.annotateLogs({ package: 'server', subsystem: 'model-catalog' }),
    Effect.withLogSpan('server.modelLayer')
  )

export interface ModelLayerResolverApi {
  readonly resolve: typeof modelLayer
}

export const ModelLayerResolver = Context.Reference<ModelLayerResolverApi>(
  '@sorato/server/ModelLayerResolver',
  { defaultValue: () => ({ resolve: modelLayer }) }
)
