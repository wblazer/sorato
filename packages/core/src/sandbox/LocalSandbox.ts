/**
 * LocalSandbox — runs in the current process, no isolation.
 *
 * Uses `@effect/platform` CommandExecutor for shell commands and Bun's file
 * APIs for filesystem operations. Fine for development and benchmarks.
 * `LocalSandboxLive` is a convenience layer with BunContext already wired in.
 */
import { Effect, Layer, Stream } from 'effect'
import { Command, CommandExecutor } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import {
  Sandbox,
  SandboxError,
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
  CommandExecutor.CommandExecutor
> = Layer.effect(
  Sandbox,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor

    const acquire = Effect.gen(function* () {
      const exec = (cmd: string): Effect.Effect<ExecResult, SandboxError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const process = yield* executor
              .start(Command.make('/bin/sh', '-c', cmd))
              .pipe(
                Effect.catchAll(
                  (error) =>
                    new SandboxError({
                      operation: 'exec',
                      message: `Failed to start command: ${cmd}`,
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
                    message: `Failed to execute command: ${cmd}`,
                    error,
                  })
              )
            )

            return { stdout, stderr, exitCode: code } satisfies ExecResult
          })
        ).pipe(Effect.withSpan('Sandbox.exec'))

      const readFile = Effect.fn('Sandbox.readFile')(function* (path: string) {
        const file = Bun.file(path)
        const exists = yield* Effect.promise(() => file.exists())
        if (!exists) {
          return yield* new SandboxError({
            operation: 'readFile',
            message: `File not found: ${path}`,
          })
        }
        return yield* Effect.promise(() => file.text())
      })

      const writeFile = Effect.fn('Sandbox.writeFile')(function* (
        path: string,
        content: string
      ) {
        yield* Effect.tryPromise({
          try: () => Bun.write(path, content),
          catch: (error) =>
            new SandboxError({
              operation: 'writeFile',
              message: `Failed to write file: ${path}`,
              error,
            }),
        })
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
