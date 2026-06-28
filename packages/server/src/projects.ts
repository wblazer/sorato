import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect } from 'effect'
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
const fileFinders = new Map<string, ReturnType<typeof createFileFinder>>()
const EXACT_PATH_SCORE_BOOST = 100
const EXTRA_PATH_SEGMENT_SCORE_PENALTY = 8
const SEARCH_PAGE_SIZE = 200

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

const createFileFinder = (project: Project) => {
  const created = FileFinder.create({ basePath: project.path, aiMode: true })
  if (!created.ok) {
    return new ProjectOperationFailed({
      code: 'project.file_search_unavailable',
      operation: 'search project files',
      message: created.error,
      retryable: false,
    })
  }

  return created.value
}

const fileFinderFor = (project: Project) => {
  const existing = fileFinders.get(project.path)
  if (existing) return existing

  const finder = createFileFinder(project)
  if (finder instanceof ProjectOperationFailed) return finder
  fileFinders.set(project.path, finder)
  return finder
}

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
      return new ProjectFileSearchResult({
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

  return new ProjectFileSearchResponse({
    entries: visibleEntries.slice(0, Math.max(1, Math.min(50, limit))),
    totalMatched: visibleEntries.length,
  })
}

const searchProjectFiles = (project: Project, query: string, limit: number) =>
  Effect.tryPromise({
    try: async () => {
      if (query.endsWith('/')) {
        const directoryResults = await searchDirectoryChildren(
          project,
          query,
          limit
        )
        if (directoryResults) return directoryResults
      }

      const finder = fileFinderFor(project)
      if (finder instanceof ProjectOperationFailed) return finder

      await finder.waitForScan(2_000)
      const result = finder.mixedSearch(query, {
        pageSize: SEARCH_PAGE_SIZE,
      })

      if (!result.ok) {
        return new ProjectOperationFailed({
          code: 'project.file_search_failed',
          operation: 'search project files',
          message: result.error,
          retryable: true,
        })
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
            result: new ProjectFileSearchResult({
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

      return new ProjectFileSearchResponse({
        entries: entries.slice(0, Math.max(1, Math.min(50, limit))),
        totalMatched: result.value.totalMatched,
      })
    },
    catch: (error) =>
      new ProjectOperationFailed({
        code: 'project.file_search_failed',
        operation: 'search project files',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result instanceof ProjectOperationFailed
        ? Effect.fail(result)
        : Effect.succeed(result)
    )
  )

export const ProjectsLive = HttpApiBuilder.group(Api, 'projects', (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStorage
    const sessions = yield* SessionStorage

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
            searchProjectFiles(project, query.query, query.limit)
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
