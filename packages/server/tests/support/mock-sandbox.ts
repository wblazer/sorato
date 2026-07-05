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
  readonly exec?:
    | ((command: ExecCommand) => Effect.Effect<ExecResult, SandboxError>)
    | undefined
}

const normalizePath = (path: string) =>
  path.replace(/^\/+/, '').replace(/\/+/g, '/')

const globToRegExp = (pattern: string) => {
  const normalized = normalizePath(pattern)
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regex = escaped
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '[^/]')
  return new RegExp(`^${regex}$`)
}

export const mockSandboxLayer = (options: MockSandboxOptions = {}) =>
  Layer.succeed(Sandbox, {
    acquire: () =>
      Effect.sync((): SandboxSession => {
        const store = new Map<string, string>(
          Object.entries(options.files ?? {}).map(([path, content]) => [
            normalizePath(path),
            content,
          ])
        )

        const files: Files = {
          readFile: (path) =>
            Effect.gen(function* () {
              const normalized = normalizePath(path)
              const content = store.get(normalized)
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
              store.set(normalizePath(path), content)
            }),
          glob: (pattern) =>
            Effect.sync(() => {
              const regex = globToRegExp(pattern)
              return [...store.keys()].filter((path) => regex.test(path)).sort()
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
