import type { AvailableModelsResponse, ModelOptions } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import { getJson, setJson, storageKey } from '$lib/storage.js'

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
    selectedModel = null
    selectedOptions = {}
  }

  function recent() {
    return getJson<StoredModelSelection | null>(
      selectionKey(connectionsStore.activeConnection?.id),
      null
    )
  }

  function remember(model: string, options: ModelOptions = {}) {
    const id = connectionsStore.activeConnection?.id
    if (!id) return
    setJson(selectionKey(id), { model, options })
  }

  function select(model: string, options: ModelOptions = {}) {
    selectedModel = model
    selectedOptions = options
    remember(model, options)
  }

  function pick() {
    const ids = new Set(models.map((item) => item.id))
    const last = recent()

    if (last && ids.has(last.model)) return last.model
    if (defaultModel && ids.has(defaultModel)) return defaultModel
    return models[0]?.id ?? null
  }

  async function load(nextProjectId: string) {
    const api = connectionsStore.getApiBase()
    if (!api) {
      clear()
      return
    }

    const id = ++req
    projectId = nextProjectId
    loading = true
    error = null

    try {
      const query = new URLSearchParams({ projectId: nextProjectId })
      const res = await fetch(`${api}/models?${query.toString()}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const data: AvailableModelsResponse = await res.json()
      if (id !== req) return

      models = data.models
      defaultModel = data.defaultModel ?? null
      const ids = new Set(models.map((item) => item.id))
      if (!selectedModel || !ids.has(selectedModel)) {
        const stored = recent()
        if (stored && ids.has(stored.model)) {
          selectedModel = stored.model
          selectedOptions = stored.options
        } else {
          selectedModel = pick()
          selectedOptions = {}
        }
      }
    } catch (err) {
      if (id !== req) return
      models = []
      defaultModel = null
      error = err instanceof Error ? err.message : 'Failed to load models'
    } finally {
      if (id === req) loading = false
    }
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
    select,
    recent,
    remember,
  }
}

export const modelsStore = createModelsStore()
