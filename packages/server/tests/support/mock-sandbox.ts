import { isAbsolute, relative, resolve } from 'node:path'
import { Effect, Layer } from 'effect'
import {
  Sandbox,
  SandboxError,
  type ExecCommand,
  type ExecResult,
  type Files,
  type SandboxSession,
  type Shell,
} from '@sorato/core'

export interface MockSandboxOptions {
  readonly files?: Readonly<Record<string, string>> | undefined
  readonly rootDirectory?: string | undefined
  readonly exec?:
    | ((command: ExecCommand) => Effect.Effect<ExecResult, SandboxError>)
    | undefined
}

const normalizePath = (path: string) => path.replace(/\/+/g, '/')

const globToRegExp = (pattern: string) => {
  const normalized = normalizePath(pattern)
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = escaped
    .replace(/\\\*\\\*\//g, '(?:.*/)?')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '[^/]')
  return new RegExp(`^${regex}$`)
}

export const mockSandboxLayer = (options: MockSandboxOptions = {}) =>
  Layer.succeed(Sandbox, {
    acquire: (directory) =>
      Effect.sync((): SandboxSession => {
        const rootDirectory = resolve(options.rootDirectory ?? '/')
        const store = new Map<string, string>(
          Object.entries(options.files ?? {}).map(([path, content]) => [
            normalizePath(
              isAbsolute(path)
                ? resolve(path)
                : resolve(rootDirectory, path.replace(/^\/+/, ''))
            ),
            content,
          ])
        )
        const sandboxRoot = resolve(directory)
        const resolveTarget = (path: string) =>
          normalizePath(
            isAbsolute(path) ? resolve(path) : resolve(sandboxRoot, path)
          )
        const relativeFiles = () =>
          [...store.keys()].flatMap((path) => {
            const fromRoot = relative(sandboxRoot, path)
            return fromRoot === '' ||
              fromRoot === '..' ||
              fromRoot.startsWith('../') ||
              isAbsolute(fromRoot)
              ? []
              : [normalizePath(fromRoot)]
          })

        const files: Files = {
          readFile: (path) =>
            Effect.gen(function* () {
              const target = resolveTarget(path)
              const content = store.get(target)
              if (content === undefined) {
                return yield* Effect.fail(
                  new SandboxError({
                    operation: 'readFile',
                    message: `File not found: ${path}`,
                  })
                )
              }
              return content
            }),
          writeFile: (path, content) =>
            Effect.sync(() => {
              store.set(resolveTarget(path), content)
            }),
          readDirectory: (path, limit) =>
            Effect.sync(() => {
              const target = resolveTarget(path)
              const prefix = target.endsWith('/') ? target : `${target}/`
              const entries = [
                ...new Set(
                  [...store.keys()].flatMap((entry) =>
                    entry.startsWith(prefix)
                      ? [entry.slice(prefix.length).split('/')[0]]
                      : []
                  )
                ),
              ]
                .filter((entry): entry is string => entry !== undefined)
                .sort()
              return {
                entries: entries.slice(0, limit).map((name) => {
                  const child = `${prefix}${name}`
                  return {
                    name,
                    type: store.has(child) ? 'file' : ('directory' as const),
                  }
                }),
                truncated: entries.length > limit,
              }
            }),
          glob: (pattern) =>
            Effect.sync(() => {
              const regex = globToRegExp(pattern)
              return (isAbsolute(pattern) ? [...store.keys()] : relativeFiles())
                .filter((path) => regex.test(path))
                .sort()
            }),
        }

        const shell: Shell = {
          exec:
            options.exec ??
            ((command) =>
              Effect.succeed({
                stdout: '',
                stderr: `Mock shell has no response for: ${command.command}`,
                exitCode: 127,
              })),
        }

        return { shell, files }
      }),
  })
