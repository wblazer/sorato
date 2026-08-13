import { ModelsApi } from '$lib/connection-services.js'
import type { UiApiError } from '$lib/api-errors.js'
import type { ModelsResponse as AvailableModelsResponse } from '@sorato/api'
import type { ModelOptions } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import {
  getJsonWithSchema,
  setJsonWithSchema,
  storageKey,
} from '$lib/storage.js'
import { Effect, Schema } from 'effect'

const ModelOptionsSchema = Schema.Struct({
  thinkingLevel: Schema.optionalKey(
    Schema.Literals([
      'off',
      'on',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  ),
  mode: Schema.optionalKey(Schema.String),
})

const StoredModelSelectionSchema = Schema.Struct({
  model: Schema.String,
  options: Schema.optionalKey(ModelOptionsSchema),
})

const StoredModelOptionsSchema = Schema.Record(
  Schema.String,
  ModelOptionsSchema
)

const selectionKey = (id: string | undefined) =>
  storageKey('connection', id, 'model-selection')

const modelOptionsKey = () => storageKey('model-options')

const modelLoadTimeout: UiApiError = {
  title: 'Model loading timed out',
  message:
    'The server did not finish loading models within 30 seconds. Retry the request or check the server logs.',
  tag: 'TimeoutError',
  code: 'models.timeout',
  status: null,
  retryable: true,
}

function createModelsStore() {
  let models = $state<AvailableModelsResponse['models']>([])
  let scenarios = $state<AvailableModelsResponse['models']>([])
  let defaultModel = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let projectId = $state<string | null>(null)
  let preferredModel = $state<string | null>(null)
  let preferredOptions = $state<ModelOptions>({})
  let selectedModel = $state<string | null>(null)
  let selectedOptions = $state<ModelOptions>({})
  let selectionKind = $state<'model' | 'scenario'>('model')
  let selectedScenario = $state<string | null>(null)
  let connectionScopeId = $state<string | null>(null)
  let req = 0

  function clear() {
    req += 1
    models = []
    scenarios = []
    defaultModel = null
    loading = false
    error = null
    projectId = null
    preferredModel = null
    preferredOptions = {}
    selectedModel = null
    selectedOptions = {}
    selectionKind = 'model'
    selectedScenario = null
    connectionScopeId = null
  }

  function recent() {
    return getJsonWithSchema(
      selectionKey(connectionsStore.activeConnectionScopeId),
      Schema.NullOr(StoredModelSelectionSchema),
      null
    )
  }

  function modelOptions(model: string) {
    return (
      getJsonWithSchema(modelOptionsKey(), StoredModelOptionsSchema, {})[
        model
      ] ?? {}
    )
  }

  function rememberModelOptions(model: string, options: ModelOptions) {
    setJsonWithSchema(modelOptionsKey(), StoredModelOptionsSchema, {
      ...getJsonWithSchema(modelOptionsKey(), StoredModelOptionsSchema, {}),
      [model]: options,
    })
  }

  function normalizeOptions(model: string, options: ModelOptions) {
    const definition = models.find((item) => item.id === model)
    if (!definition) return options

    const next: ModelOptions = {}

    if (
      options.thinkingLevel &&
      definition.capabilities.reasoning &&
      definition.capabilities.thinkingLevels.includes(options.thinkingLevel)
    ) {
      next.thinkingLevel = options.thinkingLevel
    }

    if (options.mode && definition.capabilities.modes.includes(options.mode)) {
      next.mode = options.mode
    }

    return next
  }

  function optionsForSelection(model: string, options?: ModelOptions) {
    return normalizeOptions(model, options ?? modelOptions(model))
  }

  function remember(model: string, options?: ModelOptions) {
    const id = connectionsStore.activeConnectionScopeId
    if (!id) return
    setJsonWithSchema(
      selectionKey(id),
      StoredModelSelectionSchema,
      options === undefined ? { model } : { model, options }
    )
  }

  function select(model: string, options?: ModelOptions) {
    const nextOptions = optionsForSelection(model, options)
    preferredModel = model
    preferredOptions = nextOptions
    selectedModel = model
    selectedOptions = nextOptions
    remember(model, nextOptions)
    rememberModelOptions(model, nextOptions)
  }

  function resolvePreferred() {
    if (preferredModel !== null) {
      return { model: preferredModel, options: preferredOptions }
    }

    const stored = recent()
    const noPreference = null
    if (!stored) return noPreference
    preferredModel = stored.model
    preferredOptions = optionsForSelection(stored.model, stored.options)
    return { model: stored.model, options: preferredOptions }
  }

  function pick() {
    const ids = new Set(models.map((item) => item.id))
    const preferred = resolvePreferred()

    if (preferred && ids.has(preferred.model)) return preferred.model
    if (defaultModel && ids.has(defaultModel)) return defaultModel
    return models[0]?.id ?? null
  }

  function reconcileSelection() {
    const ids = new Set(models.map((item) => item.id))
    const preferred = resolvePreferred()

    if (preferred && ids.has(preferred.model)) {
      selectedModel = preferred.model
      selectedOptions = optionsForSelection(preferred.model, preferred.options)
      return
    }

    selectedModel = pick()
    selectedOptions = selectedModel ? optionsForSelection(selectedModel) : {}
  }

  function displayName(providerId: string, modelId: string) {
    return (
      [...models, ...scenarios].find(
        (item) => item.id === modelId || item.id === `${providerId}/${modelId}`
      )?.name ?? modelId
    )
  }

  function selectScenario(scenario: string) {
    if (!import.meta.env.DEV || !scenarios.some((item) => item.id === scenario))
      return
    selectedScenario = scenario
    selectionKind = 'scenario'
  }

  function setSelectionKind(kind: 'model' | 'scenario') {
    selectionKind =
      import.meta.env.DEV && kind === 'scenario' && scenarios.length > 0
        ? 'scenario'
        : 'model'
  }

  function load(nextProjectId: string) {
    let id: number | null = null
    const clearLoading = Effect.sync(() => {
      if (id === req) loading = false
    })

    return Effect.gen(function* () {
      if (!connectionsStore.activeConnection) {
        yield* Effect.sync(clear)
        return
      }

      const activeConnectionScopeId =
        connectionsStore.activeConnectionScopeId ?? null
      if (connectionScopeId !== activeConnectionScopeId) {
        yield* Effect.sync(() => {
          clear()
          connectionScopeId = activeConnectionScopeId
        })
      }

      id = ++req
      const hasExistingForProject =
        projectId === nextProjectId &&
        (models.length > 0 || scenarios.length > 0)
      yield* Effect.sync(() => {
        projectId = nextProjectId
        loading = true
        error = null
      })

      const modelsApi = yield* ModelsApi
      const result = yield* modelsApi.list(nextProjectId).pipe(
        Effect.timeoutOrElse({
          duration: '30 seconds',
          orElse: () => Effect.fail(modelLoadTimeout),
        }),
        Effect.catch((cause: UiApiError) =>
          Effect.sync(() => {
            const failedResult = null
            if (id !== req) return failedResult
            scenarios = []
            selectedScenario = null
            if (selectionKind === 'scenario') selectionKind = 'model'
            if (!hasExistingForProject) {
              models = []
              defaultModel = null
              selectedModel = null
              selectedOptions = {}
            }
            error = cause.message
            return failedResult
          })
        )
      )

      yield* Effect.sync(() => {
        if (id !== req) return
        if (result) {
          models = result.models.filter((item) => item.kind === 'model')
          scenarios = import.meta.env.DEV
            ? result.models.filter((item) => item.kind === 'scenario')
            : []
          defaultModel = result.defaultModel ?? null
          reconcileSelection()
          if (!scenarios.some((item) => item.id === selectedScenario)) {
            selectedScenario = scenarios[0]?.id ?? null
          }
          if (scenarios.length === 0) selectionKind = 'model'
          else if (models.length === 0) selectionKind = 'scenario'
        }
      })
    }).pipe(Effect.ensuring(clearLoading))
  }

  return {
    get models() {
      return models
    },
    get scenarios() {
      return scenarios
    },
    get availableModels() {
      return [...models, ...scenarios]
    },
    get defaultModel() {
      return defaultModel
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    get projectId() {
      return projectId
    },
    get selectedModel() {
      return selectedModel
    },
    get selectedOptions() {
      return selectedOptions
    },
    get selectionKind() {
      return selectionKind
    },
    get selectedScenario() {
      return selectedScenario
    },
    get selectedTargetId() {
      return import.meta.env.DEV && selectionKind === 'scenario'
        ? selectedScenario
        : selectedModel
    },
    get selectedTargetOptions() {
      return import.meta.env.DEV && selectionKind === 'scenario'
        ? {}
        : selectedOptions
    },
    clear,
    load,
    pick,
    displayName,
    select,
    selectScenario,
    setSelectionKind,
    recent,
    remember,
  }
}

export const modelsStore = createModelsStore()
