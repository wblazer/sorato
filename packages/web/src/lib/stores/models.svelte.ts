import { apiClient, runApiEffect } from '$lib/api-client.js'
import type { UiApiError } from '$lib/api-errors.js'
import type { ModelsResponse as AvailableModelsResponse } from '@sorato/api'
import type { ModelOptions } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import { getJson, setJson, storageKey } from '$lib/storage.js'
import { Effect } from 'effect'

type StoredModelSelection = {
  readonly model: string
  readonly options: ModelOptions
}

const selectionKey = (id: string | undefined) =>
  storageKey('connection', id, 'model-selection')

function createModelsStore() {
  let models = $state<AvailableModelsResponse['models']>([])
  let defaultModel = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let projectId = $state<string | null>(null)
  let preferredModel = $state<string | null>(null)
  let preferredOptions = $state<ModelOptions>({})
  let selectedModel = $state<string | null>(null)
  let selectedOptions = $state<ModelOptions>({})
  let req = 0

  function clear() {
    req += 1
    models = []
    defaultModel = null
    loading = false
    error = null
    projectId = null
    preferredModel = null
    preferredOptions = {}
    selectedModel = null
    selectedOptions = {}
  }

  function recent() {
    return getJson<StoredModelSelection | null>(
      selectionKey(connectionsStore.activeConnectionScopeId),
      null
    )
  }

  function remember(model: string, options: ModelOptions = {}) {
    const id = connectionsStore.activeConnectionScopeId
    if (!id) return
    setJson(selectionKey(id), { model, options })
  }

  function select(model: string, options: ModelOptions = {}) {
    preferredModel = model
    preferredOptions = options
    selectedModel = model
    selectedOptions = options
    remember(model, options)
  }

  function resolvePreferred() {
    if (preferredModel !== null) {
      return { model: preferredModel, options: preferredOptions }
    }

    const stored = recent()
    const noPreference = null
    if (!stored) return noPreference
    preferredModel = stored.model
    preferredOptions = stored.options
    return stored
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
      selectedOptions = preferred.options
      return
    }

    selectedModel = pick()
    selectedOptions = {}
  }

  function displayName(providerId: string, modelId: string) {
    return (
      models.find(
        (item) => item.id === modelId || item.id === `${providerId}/${modelId}`
      )?.name ?? modelId
    )
  }

  function load(nextProjectId: string) {
    return Effect.gen(function* () {
      const api = connectionsStore.getApiBase()
      if (!api) {
        yield* Effect.sync(clear)
        return
      }

      const id = ++req
      const hasExistingForProject =
        projectId === nextProjectId && models.length > 0
      yield* Effect.sync(() => {
        projectId = nextProjectId
        loading = true
        error = null
      })

      const client = yield* apiClient(api)
      const result = yield* runApiEffect(
        client.models.list({ query: { projectId: nextProjectId } }),
        'Failed to load models'
      ).pipe(
        Effect.catch((cause: UiApiError) =>
          Effect.sync(() => {
            const failedResult = null
            if (id !== req) return failedResult
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
          models = result.models
          defaultModel = result.defaultModel ?? null
          reconcileSelection()
        }
        loading = false
      })
    })
  }

  return {
    get models() {
      return models
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
    clear,
    load,
    pick,
    displayName,
    select,
    recent,
    remember,
  }
}

export const modelsStore = createModelsStore()
