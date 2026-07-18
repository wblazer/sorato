import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Duration, Effect, Exit, ScopedCache } from 'effect'
import { FileFinder } from '@ff-labs/fff-node'
import {
  Api,
  ProjectFileSearchResponse,
  ProjectFileSearchResult,
  ProjectOperationFailed,
  ProjectResponse,
  StorageUnavailable,
} from '@sorato/api'
import { ProjectStorage, type Project } from './project/project.ts'
import { SessionStorage } from './session/session.ts'

const mapProjectError = ProjectOperationFailed.fromProject
const mapStorageError = StorageUnavailable.fromStorage
const FILE_FINDER_CACHE_CAPACITY = 16
const EXACT_PATH_SCORE_BOOST = 100
const EXTRA_PATH_SEGMENT_SCORE_PENALTY = 8
const SEARCH_PAGE_SIZE = 200

const toProjectResponse = (project: Project) =>
  ProjectResponse.make({
    id: project.id,
    name: project.name,
    path: project.path,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
  })

const createFileFinder = (projectPath: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        FileFinder.create({
          basePath: projectPath,
          aiMode: true,
          enableHomeDirScanning: true,
          enableFsRootScanning: true,
        }),
      catch: (error) =>
        new ProjectOperationFailed({
          code: 'project.file_search_failed',
          operation: 'search project files',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        }),
    }).pipe(
      Effect.flatMap((created) =>
        created.ok
          ? Effect.succeed(created.value)
          : Effect.fail(
              new ProjectOperationFailed({
                code: 'project.file_search_unavailable',
                operation: 'search project files',
                message: created.error,
                retryable: false,
              })
            )
      )
    ),
    (finder) => Effect.sync(() => finder.destroy())
  )

const isWithinProject = (projectPath: string, path: string) => {
  const child = relative(projectPath, path)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

const normalizeSearchPath = (path: string) =>
  path.replace(/\/+$/, '').toLowerCase()

const pathSegmentCount = (path: string) =>
  normalizeSearchPath(path).split('/').filter(Boolean).length

const resolveExistingPath = async (base: string, query: string) => {
  const segments = query.split('/').filter((segment) => segment.length > 0)
  let current = base

  for (const segment of segments) {
    const entries = await readdir(current, { withFileTypes: true })
    const match = entries.find(
      (entry) => entry.name.toLowerCase() === segment.toLowerCase()
    )
    if (!match) return undefined
    current = join(current, match.name)
  }

  return current
}

const searchDirectoryChildren = async (
  project: Project,
  query: string,
  limit: number
) => {
  const base = resolve(project.path)
  const directory = await resolveExistingPath(base, query)
  if (!directory || !isWithinProject(base, directory)) return undefined

  const entries = await readdir(directory, { withFileTypes: true })
  const visibleEntries = entries
    .filter(
      (entry) =>
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules' &&
        (entry.isDirectory() || entry.isFile())
    )
    .map((entry) => {
      const path = relative(base, join(directory, entry.name)).replaceAll(
        '\\',
        '/'
      )
      return ProjectFileSearchResult.make({
        path: entry.isDirectory() ? `${path}/` : path,
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      })
    })
    .sort(
      (a, b) =>
        Number(b.type === 'directory') - Number(a.type === 'directory') ||
        a.name.localeCompare(b.name)
    )

  return ProjectFileSearchResponse.make({
    entries: visibleEntries.slice(0, Math.max(1, Math.min(50, limit))),
    totalMatched: visibleEntries.length,
  })
}

const searchProjectFiles = (
  fileFinders: ScopedCache.ScopedCache<
    string,
    FileFinder,
    ProjectOperationFailed
  >,
  project: Project,
  query: string,
  limit: number
) =>
  Effect.gen(function* () {
    if (query.endsWith('/')) {
      const directoryResults = yield* Effect.tryPromise({
        try: () => searchDirectoryChildren(project, query, limit),
        catch: (error) =>
          new ProjectOperationFailed({
            code: 'project.file_search_failed',
            operation: 'search project files',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          }),
      })
      if (directoryResults) return directoryResults
    }

    const finder = yield* ScopedCache.get(fileFinders, project.path)
    const result = yield* Effect.tryPromise({
      try: async () => {
        await finder.waitForScan(2_000)
        return finder.mixedSearch(query, {
          pageSize: SEARCH_PAGE_SIZE,
        })
      },
      catch: (error) =>
        new ProjectOperationFailed({
          code: 'project.file_search_failed',
          operation: 'search project files',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        }),
    })

    if (!result.ok) {
      return yield* Effect.fail(
        new ProjectOperationFailed({
          code: 'project.file_search_failed',
          operation: 'search project files',
          message: result.error,
          retryable: true,
        })
      )
    }

    const entries = result.value.items
      .map((item, index) => {
        const score = result.value.scores[index]?.total
        const isExactPathMatch =
          normalizeSearchPath(item.item.relativePath) ===
          normalizeSearchPath(query)
        const extraPathSegments = Math.max(
          0,
          pathSegmentCount(item.item.relativePath) - pathSegmentCount(query)
        )
        return {
          result: ProjectFileSearchResult.make({
            path: item.item.relativePath,
            name:
              item.type === 'directory'
                ? item.item.dirName.replace(/\/$/, '')
                : item.item.fileName,
            type: item.type,
            ...(score === undefined ? {} : { score }),
          }),
          boostedScore:
            (score ?? 0) +
            (isExactPathMatch ? EXACT_PATH_SCORE_BOOST : 0) -
            extraPathSegments * EXTRA_PATH_SEGMENT_SCORE_PENALTY,
        }
      })
      .sort((a, b) => b.boostedScore - a.boostedScore)
      .map((item) => item.result)

    return ProjectFileSearchResponse.make({
      entries: entries.slice(0, Math.max(1, Math.min(50, limit))),
      totalMatched: result.value.totalMatched,
    })
  })

export const ProjectsLive = HttpApiBuilder.group(Api, 'projects', (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStorage
    const sessions = yield* SessionStorage
    const fileFinders = yield* ScopedCache.makeWith({
      capacity: FILE_FINDER_CACHE_CAPACITY,
      lookup: createFileFinder,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
    })

    return handlers
      .handle('list', () =>
        projects.list().pipe(
          Effect.map((items) => items.map(toProjectResponse)),
          Effect.mapError(mapProjectError)
        )
      )
      .handle('create', ({ payload }) =>
        projects
          .createLocalDirectory({
            path: payload.path,
            ...(payload.name === undefined ? {} : { name: payload.name }),
          })
          .pipe(Effect.map(toProjectResponse), Effect.mapError(mapProjectError))
      )
      .handle('get', ({ params }) =>
        projects
          .get(params.id)
          .pipe(Effect.map(toProjectResponse), Effect.mapError(mapProjectError))
      )
      .handle('searchFiles', ({ params, query }) =>
        projects.get(params.id).pipe(
          Effect.mapError(mapProjectError),
          Effect.flatMap((project) =>
            searchProjectFiles(fileFinders, project, query.query, query.limit)
          )
        )
      )
      .handle('archive', ({ params, payload }) =>
        (payload.archiveSessions === true
          ? sessions
              .archiveByProject(params.id)
              .pipe(Effect.mapError(mapStorageError))
          : Effect.void
        ).pipe(
          Effect.andThen(
            projects.archive(params.id).pipe(Effect.mapError(mapProjectError))
          )
        )
      )
  })
)
