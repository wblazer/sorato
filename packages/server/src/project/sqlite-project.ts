import { basename } from 'node:path'
import { Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import {
  ProjectError,
  ProjectStorage,
  type Project,
  type ProjectId,
  type ProjectStorageApi,
} from './project.ts'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    name           TEXT NOT NULL,
    locator_json   TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    last_opened_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at)',
]

interface ProjectRow {
  id: string
  kind: string
  name: string
  locator_json: string
  created_at: number
  updated_at: number
  last_opened_at: number | null
}

const LocalDirectoryLocator = Schema.Struct({ path: Schema.String })

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  kind: 'local-directory',
  name: row.name,
  locator: Schema.decodeUnknownSync(LocalDirectoryLocator)(
    JSON.parse(row.locator_json)
  ),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastOpenedAt: row.last_opened_at,
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

    yield* Effect.forEach(SCHEMA, (statement) => sql.unsafe(statement)).pipe(
      Effect.mapError(sqlFailure('open', 'Failed to initialize projects table'))
    )

    const createLocalDirectory: ProjectStorageApi['createLocalDirectory'] =
      Effect.fn('ProjectStorage.createLocalDirectory')(function* ({
        path,
        name,
      }) {
        const id = crypto.randomUUID()
        const now = Date.now()
        const resolvedName = projectName(path, name)
        const locator = { path }

        yield* sql`
          INSERT INTO projects (id, kind, name, locator_json, created_at, updated_at, last_opened_at)
          VALUES (${id}, ${'local-directory'}, ${resolvedName}, ${JSON.stringify(locator)}, ${now}, ${now}, ${now})
        `.pipe(
          Effect.mapError(
            sqlFailure('createLocalDirectory', 'Failed to create project')
          )
        )

        return {
          id,
          kind: 'local-directory',
          name: resolvedName,
          locator,
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
        }
      })

    const get = Effect.fn('ProjectStorage.get')(function* (id: ProjectId) {
      const rows = yield* sql<ProjectRow>`
        SELECT * FROM projects WHERE id = ${id}
      `.pipe(Effect.mapError(sqlFailure('get', `Failed to get project: ${id}`)))
      const row = rows[0]

      return yield* Effect.fromNullishOr(row).pipe(
        Effect.mapError(
          () =>
            new ProjectError({
              operation: 'get',
              message: `Project not found: ${id}`,
            })
        ),
        Effect.map(toProject)
      )
    })

    const list = Effect.fn('ProjectStorage.list')(function* () {
      const rows = yield* sql<ProjectRow>`
        SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at) DESC
      `.pipe(Effect.mapError(sqlFailure('list', 'Failed to list projects')))
      return rows.map(toProject)
    })

    const touch = Effect.fn('ProjectStorage.touch')(function* (id: ProjectId) {
      yield* get(id)
      const now = Date.now()
      yield* sql`
        UPDATE projects SET last_opened_at = ${now}, updated_at = ${now} WHERE id = ${id}
      `.pipe(
        Effect.mapError(
          sqlFailure('touch', `Failed to mark project opened: ${id}`)
        )
      )
    })

    const del = Effect.fn('ProjectStorage.delete')(function* (id: ProjectId) {
      yield* sql`DELETE FROM projects WHERE id = ${id}`.pipe(
        Effect.mapError(sqlFailure('delete', `Failed to delete project: ${id}`))
      )
    })

    const resolvePath = Effect.fn('ProjectStorage.resolvePath')(function* (
      id: ProjectId
    ) {
      const project = yield* get(id)
      return project.locator.path
    })

    return ProjectStorage.of({
      createLocalDirectory,
      get,
      list,
      touch,
      delete: del,
      resolvePath,
    })
  })
)
