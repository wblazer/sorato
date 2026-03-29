import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from './api.ts'
import { listModels } from './model-catalog.ts'

export const ModelsLive = HttpApiBuilder.group(Api, 'models', (handlers) =>
  handlers.handle('list', ({ query }) => listModels(query.directory))
)
