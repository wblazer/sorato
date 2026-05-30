import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect } from 'effect'
import { Api, ProjectOperationFailed } from './api.ts'
import { listModels } from './model-catalog.ts'
import { ProjectStorage } from './project/project.ts'

export const ModelsLive = HttpApiBuilder.group(Api, 'models', (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStorage

    return handlers.handle('list', ({ query }) =>
      projects.resolvePath(query.projectId).pipe(
        Effect.mapError(ProjectOperationFailed.fromProject),
        Effect.flatMap((projectPath) => listModels(projectPath))
      )
    )
  })
)
