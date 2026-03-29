import type { AvailableModelsResponse } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import { getJson, setJson, storageKey } from '$lib/storage.js'

const recentKey = (id: string | undefined) =>
  storageKey('connection', id, 'recent-model')

function createModelsStore() {
  let models = $state<AvailableModelsResponse['models']>([])
  let defaultModel = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let directory = $state<string | null>(null)
  let req = 0

  function clear() {
    req += 1
    models = []
    defaultModel = null
    loading = false
    error = null
    directory = null
  }

  function recent() {
    return getJson<string | null>(
      recentKey(connectionsStore.activeConnection?.id),
      null
    )
  }

  function remember(model: string) {
    const id = connectionsStore.activeConnection?.id
    if (!id) return
    setJson(recentKey(id), model)
  }

  function pick() {
    const ids = new Set(models.map((item) => item.id))
    const last = recent()

    if (last && ids.has(last)) return last
    if (defaultModel && ids.has(defaultModel)) return defaultModel
    return models[0]?.id ?? null
  }

  async function load(dir: string) {
    const api = connectionsStore.getApiBase()
    if (!api) {
      clear()
      return
    }

    const id = ++req
    directory = dir
    loading = true
    error = null

    try {
      const query = new URLSearchParams({ directory: dir })
      const res = await fetch(`${api}/models?${query.toString()}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const data: AvailableModelsResponse = await res.json()
      if (id !== req) return

      models = data.models
      defaultModel = data.defaultModel ?? null
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
    get directory() {
      return directory
    },
    clear,
    load,
    pick,
    recent,
    remember,
  }
}

export const modelsStore = createModelsStore()
