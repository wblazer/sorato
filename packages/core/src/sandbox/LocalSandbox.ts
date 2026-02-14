/**
 * LocalSandbox — runs in the current process, no isolation.
 *
 * Uses `@effect/platform` CommandExecutor and FileSystem for process +
 * filesystem operations. Each session gets a temporary root directory and
 * all paths are resolved under it. Fine for development and benchmarks.
 * `LocalSandboxLive` is a convenience layer with BunContext already wired in.
 */
import { Effect, Layer, Stream } from 'effect'
import { Command, CommandExecutor, FileSystem, Path } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import {
  Sandbox,
  SandboxError,
  type ExecCommand,
  type ExecResult,
  type SandboxSession,
} from './Sandbox.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect a Uint8Array stream into a single string. */
const streamToString = <E>(
  stream: Stream.Stream<Uint8Array, E>
): Effect.Effect<string, E> => stream.pipe(Stream.decodeText(), Stream.mkString)

// ---------------------------------------------------------------------------
// LocalSandbox
// ---------------------------------------------------------------------------

export const LocalSandbox: Layer.Layer<
  Sandbox,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  Sandbox,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const acquire = Effect.gen(function* () {
      const rootDir = yield* fs
        .makeTempDirectoryScoped({
          prefix: 'agents-sandbox-',
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'acquire',
                message: 'Failed to create sandbox root',
                error,
              })
          )
        )

      const resolvePath = (target: string, operation: string) => {
        const relative = path.isAbsolute(target)
          ? target.replace(/^\/+/, '')
          : target
        const resolved = path.resolve(rootDir, relative)
        const rootPrefix = rootDir.endsWith(path.sep)
          ? rootDir
          : `${rootDir}${path.sep}`

        if (resolved === rootDir || resolved.startsWith(rootPrefix)) {
          return Effect.succeed(resolved)
        }

        return Effect.fail(
          new SandboxError({
            operation,
            message: `Path escapes sandbox root: ${target}`,
          })
        )
      }

      const exec = (
        input: ExecCommand
      ): Effect.Effect<ExecResult, SandboxError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const cwd = input.cwd
              ? yield* resolvePath(input.cwd, 'exec')
              : rootDir

            let command = Command.make('/bin/sh', '-c', input.command)
            command = Command.workingDirectory(command, cwd)

            if (input.env) {
              command = Command.env(command, input.env)
            }

            if (input.stdin !== undefined) {
              command = Command.feed(command, input.stdin)
            }

            const process = yield* executor.start(command).pipe(
              Effect.catchAll(
                (error) =>
                  new SandboxError({
                    operation: 'exec',
                    message: `Failed to start command: ${input.command}`,
                    error,
                  })
              )
            )

            const [stdout, stderr, code] = yield* Effect.all([
              streamToString(process.stdout),
              streamToString(process.stderr),
              process.exitCode,
            ] as const).pipe(
              Effect.catchAll(
                (error) =>
                  new SandboxError({
                    operation: 'exec',
                    message: `Failed to execute command: ${input.command}`,
                    error,
                  })
              )
            )

            return { stdout, stderr, exitCode: code } satisfies ExecResult
          })
        ).pipe(Effect.withSpan('Sandbox.exec'))

      const readFile = Effect.fn('Sandbox.readFile')(function* (
        filePath: string
      ) {
        const resolved = yield* resolvePath(filePath, 'readFile')
        const exists = yield* fs.exists(resolved).pipe(
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'readFile',
                message: `Failed to access file: ${filePath}`,
                error,
              })
          )
        )

        if (!exists) {
          return yield* new SandboxError({
            operation: 'readFile',
            message: `File not found: ${filePath}`,
          })
        }

        return yield* fs.readFileString(resolved).pipe(
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'readFile',
                message: `Failed to read file: ${filePath}`,
                error,
              })
          )
        )
      })

      const writeFile = Effect.fn('Sandbox.writeFile')(function* (
        filePath: string,
        content: string
      ) {
        const resolved = yield* resolvePath(filePath, 'writeFile')
        yield* fs.writeFileString(resolved, content).pipe(
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'writeFile',
                message: `Failed to write file: ${filePath}`,
                error,
              })
          )
        )
      })

      return { exec, readFile, writeFile } satisfies SandboxSession
    })

    return Sandbox.of({ acquire })
  })
)

/**
 * Convenience layer that provides LocalSandbox with Bun's platform services
 * already wired in. Use this in scripts/tests where you want zero setup.
 */
export const LocalSandboxLive: Layer.Layer<Sandbox> = LocalSandbox.pipe(
  Layer.provide(BunContext.layer)
)
