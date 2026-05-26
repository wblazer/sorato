import { basename } from 'node:path'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import {
  ProjectError,
  ProjectStorage,
  type Project,
  type ProjectId,
  type ProjectStorageApi,
} from './project.ts'

const SCHEMA = [
  'PRAGMA foreign_keys = ON',
  `CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    path           TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    last_opened_at INTEGER,
    archived_at    INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived_at)',
]

interface ProjectRow {
  id: string
  name: string
  path: string
  created_at: number
  updated_at: number
  last_opened_at: number | null
  archived_at: number | null
}

const toProject = (row: ProjectRow): Project => ({
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

        yield* sql`
          INSERT INTO projects (id, name, path, created_at, updated_at, last_opened_at)
          VALUES (${id}, ${resolvedName}, ${path}, ${now}, ${now}, ${now})
        `.pipe(
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
        SELECT * FROM projects
        WHERE archived_at IS NULL
        ORDER BY COALESCE(last_opened_at, updated_at) DESC
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

    const archive = Effect.fn('ProjectStorage.archive')(function* (
      id: ProjectId
    ) {
      yield* get(id)
      const now = Date.now()
      yield* sql`
        UPDATE projects SET archived_at = ${now}, updated_at = ${now} WHERE id = ${id}
      `.pipe(
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
