import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect } from 'effect'
import { Api, ProjectResponse } from './api.ts'
import { ProjectStorage, type Project } from './project/project.ts'
import { SessionStorage } from './session/session.ts'

const toProjectResponse = (project: Project) =>
  new ProjectResponse({
    id: project.id,
    name: project.name,
    path: project.path,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
  })

export const ProjectsLive = HttpApiBuilder.group(Api, 'projects', (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStorage
    const sessions = yield* SessionStorage

    return handlers
      .handle('list', () =>
        projects
          .list()
          .pipe(Effect.map((items) => items.map(toProjectResponse)))
      )
      .handle('create', ({ payload }) =>
        projects
          .createLocalDirectory({
            path: payload.path,
            ...(payload.name === undefined ? {} : { name: payload.name }),
          })
          .pipe(Effect.map(toProjectResponse))
      )
      .handle('get', ({ params }) =>
        projects.get(params.id).pipe(Effect.map(toProjectResponse))
      )
      .handle('archive', ({ params, payload }) =>
        (payload.archiveSessions === true
          ? sessions.archiveByProject(params.id)
          : Effect.void
        ).pipe(Effect.andThen(projects.archive(params.id)))
      )
  })
)
