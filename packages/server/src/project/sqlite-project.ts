import { basename } from 'node:path'
import { Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'
import { ProjectTableRow } from '../db/schema.ts'
import {
  ProjectError,
  ProjectStorage,
  type Project,
  type ProjectId,
  type ProjectStorageApi,
} from './project.ts'

const ProjectIdInput = Schema.Struct({
  id: Schema.String,
})

const InsertProjectInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number,
  last_opened_at: Schema.NullOr(Schema.Number),
})

const UpdateProjectOpenedInput = Schema.Struct({
  id: Schema.String,
  now: Schema.Number,
})

const ArchiveProjectInput = Schema.Struct({
  id: Schema.String,
  now: Schema.Number,
})

const toProject = (row: ProjectTableRow): Project => ({
  id: row.id,
  name: row.name,
  path: row.path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastOpenedAt: row.last_opened_at,
  archivedAt: row.archived_at,
})

const projectName = (path: string, name?: string) => {
  if (name && name.trim().length > 0) return name.trim()
  return basename(path) || path
}

const sqlFailure = (operation: string, message: string) => (error: unknown) =>
  new ProjectError({ operation, message, error })

export const SqliteProject = Layer.effect(ProjectStorage)(
  Effect.gen(function* () {
    const sql = yield* SqlClient

    const insertProjectRow = SqlSchema.void({
      Request: InsertProjectInput,
      execute: ({ id, name, path, created_at, updated_at, last_opened_at }) =>
        sql`
          INSERT INTO projects (
            id,
            name,
            path,
            created_at,
            updated_at,
            last_opened_at
          )
          VALUES (
            ${id},
            ${name},
            ${path},
            ${created_at},
            ${updated_at},
            ${last_opened_at}
          )
        `,
    })

    const getProjectRow = SqlSchema.findOneOption({
      Request: ProjectIdInput,
      Result: ProjectTableRow,
      execute: ({ id }) =>
        sql`
          SELECT
            id,
            name,
            path,
            created_at,
            updated_at,
            last_opened_at,
            archived_at
          FROM projects
          WHERE id = ${id}
        `,
    })

    const listProjectRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: ProjectTableRow,
      execute: () =>
        sql`
          SELECT
            id,
            name,
            path,
            created_at,
            updated_at,
            last_opened_at,
            archived_at
          FROM projects
          WHERE archived_at IS NULL
          ORDER BY COALESCE(last_opened_at, updated_at) DESC
        `,
    })

    const updateProjectOpenedRow = SqlSchema.void({
      Request: UpdateProjectOpenedInput,
      execute: ({ id, now }) =>
        sql`
          UPDATE projects
          SET last_opened_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `,
    })

    const archiveProjectRow = SqlSchema.void({
      Request: ArchiveProjectInput,
      execute: ({ id, now }) =>
        sql`
          UPDATE projects
          SET archived_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `,
    })

    const createLocalDirectory: ProjectStorageApi['createLocalDirectory'] =
      Effect.fn('ProjectStorage.createLocalDirectory')(function* ({
        path,
        name,
      }) {
        const id = crypto.randomUUID()
        const now = Date.now()
        const resolvedName = projectName(path, name)

        yield* insertProjectRow({
          id,
          name: resolvedName,
          path,
          created_at: now,
          updated_at: now,
          last_opened_at: now,
        }).pipe(
          Effect.mapError(
            sqlFailure('createLocalDirectory', 'Failed to create project')
          )
        )

        return {
          id,
          name: resolvedName,
          path,
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
          archivedAt: null,
        }
      })

    const get = Effect.fn('ProjectStorage.get')(function* (id: ProjectId) {
      const row = yield* getProjectRow({ id }).pipe(
        Effect.mapError(sqlFailure('get', `Failed to get project: ${id}`))
      )

      return yield* Option.match(row, {
        onNone: () =>
          Effect.fail(
            new ProjectError({
              operation: 'get',
              message: `Project not found: ${id}`,
            })
          ),
        onSome: (project) => Effect.succeed(toProject(project)),
      })
    })

    const list = Effect.fn('ProjectStorage.list')(function* () {
      const rows = yield* listProjectRows().pipe(
        Effect.mapError(sqlFailure('list', 'Failed to list projects'))
      )
      return rows.map(toProject)
    })

    const touch = Effect.fn('ProjectStorage.touch')(function* (id: ProjectId) {
      yield* get(id)
      yield* updateProjectOpenedRow({ id, now: Date.now() }).pipe(
        Effect.mapError(
          sqlFailure('touch', `Failed to mark project opened: ${id}`)
        )
      )
    })

    const archive = Effect.fn('ProjectStorage.archive')(function* (
      id: ProjectId
    ) {
      yield* get(id)
      yield* archiveProjectRow({ id, now: Date.now() }).pipe(
        Effect.mapError(
          sqlFailure('archive', `Failed to archive project: ${id}`)
        )
      )
    })

    const resolvePath = Effect.fn('ProjectStorage.resolvePath')(function* (
      id: ProjectId
    ) {
      const project = yield* get(id)
      return project.path
    })

    return ProjectStorage.of({
      createLocalDirectory,
      get,
      list,
      touch,
      archive,
      resolvePath,
    })
  })
)
