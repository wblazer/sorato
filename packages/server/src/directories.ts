/**
 * Directories group handler implementation.
 *
 * Lists directory contents with path resolution:
 *   ~ or ""  → home directory
 *   ~/path   → relative to home
 *   /path    → absolute
 *   bare     → relative to home (bare names resolve against ~, not cwd)
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect, Match } from 'effect'
import {
  Api,
  DirectoryEntry,
  DirectoryError,
  DirectoryListResponse,
} from '@sorato/api'

/** Resolve a path string: expand ~, resolve relative to home */
const resolvePath = (raw: string): string => {
  if (raw === '~' || raw === '') return homedir()
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2))
  if (raw.startsWith('/')) return raw
  // Bare names resolve against home, not cwd
  return join(homedir(), raw)
}

const entryType = (isDirectory: boolean) =>
  Match.value(isDirectory).pipe(
    Match.when(true, (): 'directory' => 'directory'),
    Match.orElse((): 'file' => 'file')
  )

const toDirectoryEntry = (
  resolved: string,
  name: string,
  isDirectory: boolean
) =>
  DirectoryEntry.make({
    name,
    path: join(resolved, name),
    type: entryType(isDirectory),
  })

export const DirectoriesLive = HttpApiBuilder.group(
  Api,
  'directories',
  (handlers) =>
    handlers.handle('list', ({ query }) =>
      Effect.gen(function* () {
        const resolved = resolvePath(query.path)

        yield* Effect.tryPromise({
          try: () => stat(resolved),
          catch: () =>
            new DirectoryError({
              message: `Path does not exist: ${resolved}`,
            }),
        }).pipe(
          Effect.filterOrFail(
            (info) => info.isDirectory(),
            () =>
              new DirectoryError({
                message: `Not a directory: ${resolved}`,
              })
          )
        )

        const rawEntries = yield* Effect.tryPromise({
          try: () => readdir(resolved, { withFileTypes: true }),
          catch: () =>
            new DirectoryError({
              message: `Cannot read directory: ${resolved}`,
            }),
        })

        const entries = rawEntries
          .filter(
            (e) =>
              !e.name.startsWith('.') &&
              e.name !== 'node_modules' &&
              (e.isDirectory() || e.isFile())
          )
          .map((e) => toDirectoryEntry(resolved, e.name, e.isDirectory()))
          .sort(
            (a, b) =>
              Number(b.type === 'directory') - Number(a.type === 'directory') ||
              a.name.localeCompare(b.name)
          )

        return DirectoryListResponse.make({
          resolved,
          home: homedir(),
          entries,
        })
      })
    )
)
