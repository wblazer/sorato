import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect } from 'effect'
import { Api, ProjectOperationFailed } from '@sorato/api'
import { ModelCatalog } from './model-catalog.ts'
import { ProjectStorage } from './project/project.ts'

export const ModelsLive = HttpApiBuilder.group(Api, 'models', (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStorage
    const catalog = yield* ModelCatalog

    return handlers.handle('list', ({ query }) =>
      projects.resolvePath(query.projectId).pipe(
        Effect.mapError(ProjectOperationFailed.fromProject),
        Effect.flatMap((projectPath) => catalog.list(projectPath))
      )
    )
  })
)
