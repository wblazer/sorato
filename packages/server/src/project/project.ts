import { Context, Schema } from 'effect'
import type { Effect } from 'effect/Effect'

export const ProjectId = Schema.String
export type ProjectId = string

export class ProjectError extends Schema.TaggedErrorClass<ProjectError>()(
  'ProjectError',
  {
    operation: Schema.String,
    message: Schema.String,
    error: Schema.optional(Schema.Defect()),
  }
) {}

export interface Project {
  readonly id: ProjectId
  readonly name: string
  readonly path: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastOpenedAt: number | null
  readonly archivedAt: number | null
}

export interface ProjectStorageApi {
  readonly createLocalDirectory: (options: {
    readonly path: string
    readonly name?: string
  }) => Effect<Project, ProjectError>
  readonly get: (id: ProjectId) => Effect<Project, ProjectError>
  readonly list: () => Effect<ReadonlyArray<Project>, ProjectError>
  readonly touch: (id: ProjectId) => Effect<void, ProjectError>
  readonly archive: (id: ProjectId) => Effect<void, ProjectError>
  readonly resolvePath: (id: ProjectId) => Effect<string, ProjectError>
}

export class ProjectStorage extends Context.Service<
  ProjectStorage,
  ProjectStorageApi
>()('@sorato/ProjectStorage') {}
