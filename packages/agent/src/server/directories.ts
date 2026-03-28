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
import { Effect } from 'effect'
import {
  Api,
  DirectoryEntry,
  DirectoryError,
  DirectoryListResponse,
} from './api.ts'

/** Resolve a path string: expand ~, resolve relative to home */
const resolvePath = (raw: string): string => {
  if (raw === '~' || raw === '') return homedir()
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2))
  if (raw.startsWith('/')) return raw
  // Bare names resolve against home, not cwd
  return join(homedir(), raw)
}

export const DirectoriesLive = HttpApiBuilder.group(
  Api,
  'directories',
  (handlers) =>
    handlers.handle('list', ({ query }) =>
      Effect.gen(function* () {
        const resolved = resolvePath(query.path)

        // Verify the path exists and is a directory
        const info = yield* Effect.tryPromise({
          try: () => stat(resolved),
          catch: () =>
            new DirectoryError({
              message: `Path does not exist: ${resolved}`,
            }),
        })

        if (!info.isDirectory()) {
          return yield* new DirectoryError({
            message: `Not a directory: ${resolved}`,
          })
        }

        const rawEntries = yield* Effect.tryPromise({
          try: () => readdir(resolved, { withFileTypes: true }),
          catch: () =>
            new DirectoryError({
              message: `Cannot read directory: ${resolved}`,
            }),
        })

        const entries = rawEntries
          .filter((e) => {
            // Skip hidden files/dirs and common noise
            if (e.name.startsWith('.')) return false
            if (e.name === 'node_modules') return false
            return e.isDirectory() || e.isFile()
          })
          .map(
            (e) =>
              new DirectoryEntry({
                name: e.name,
                path: join(resolved, e.name),
                type: e.isDirectory() ? 'directory' : 'file',
              })
          )
          .sort((a, b) => {
            // Directories first, then alphabetical
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })

        return new DirectoryListResponse({
          resolved,
          home: homedir(),
          entries,
        })
      })
    )
)
