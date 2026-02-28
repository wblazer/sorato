/**
 * LocalSandbox — runs in the current process, no isolation.
 *
 * Uses `@effect/platform` CommandExecutor and FileSystem for process +
 * filesystem operations. Each session gets a temporary root directory and
 * all paths are resolved under it. Fine for development and benchmarks.
 * `LocalSandboxLive` is a convenience layer with BunContext already wired in.
 */
import { Effect, Fiber, Layer, Stream } from 'effect'
import { Command, CommandExecutor, FileSystem, Path } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import {
  Sandbox,
  SandboxError,
  type ExecCommand,
  type ExecResult,
  type Shell,
  type Files,
  type SandboxSession,
} from './sandbox.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect a Uint8Array stream into a single string. */
const streamToString = <E>(
  stream: Stream.Stream<Uint8Array, E>
): Effect.Effect<string, E> => stream.pipe(Stream.decodeText(), Stream.mkString)

/**
 * Non-interactive environment defaults. Prevents spawned processes from
 * blocking on pagers, editors, prompts, or interactive input — the kinds
 * of things that hang an agent loop indefinitely.
 *
 * These are merged *under* any user-supplied env vars, so callers can
 * override individual values if needed.
 */
const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
  // -- Pagers: force non-interactive output --
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  MANPAGER: 'cat',
  SYSTEMD_PAGER: 'cat',
  BAT_PAGER: 'cat',
  DELTA_PAGER: 'cat',
  // -- Editors: no-op so git commit etc. don't block --
  GIT_EDITOR: 'true',
  VISUAL: 'true',
  EDITOR: 'true',
  // -- Git: suppress interactive prompts --
  GIT_TERMINAL_PROMPT: '0',
  // -- CI flag: many tools use this to disable interactivity --
  CI: '1',
  // -- Package managers: disable prompts, progress bars, update checks --
  npm_config_yes: 'true',
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  npm_config_progress: 'false',
  YARN_ENABLE_TELEMETRY: '0',
  // -- Terminal: suppress colors and control sequences --
  TERM: 'dumb',
  NO_COLOR: '1',
}

/** Grace period between SIGTERM and SIGKILL during timeout kill. */
const KILL_GRACE_MS = 500

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

      // -- Shell service --------------------------------------------------

      const exec = (
        input: ExecCommand
      ): Effect.Effect<ExecResult, SandboxError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const cwd = input.cwd
              ? yield* resolvePath(input.cwd, 'exec')
              : rootDir

            // Merge non-interactive defaults under user env (user wins)
            const mergedEnv: Record<string, string | undefined> = {
              ...NON_INTERACTIVE_ENV,
              ...input.env,
            }

            let command = Command.make('/bin/sh', '-c', input.command)
            command = Command.workingDirectory(command, cwd)
            command = Command.env(command, mergedEnv)

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

            /**
             * Kill the process gracefully: SIGTERM → grace period → SIGKILL.
             * Ignores errors from kill() since the process may already be dead.
             */
            const killGracefully = process.kill('SIGTERM').pipe(
              Effect.andThen(Effect.sleep(KILL_GRACE_MS)),
              Effect.andThen(
                process.isRunning.pipe(
                  Effect.flatMap((running) =>
                    running ? process.kill('SIGKILL') : Effect.void
                  )
                )
              ),
              Effect.catchAll(() => Effect.void)
            )

            /**
             * Collect output and wait for exit. If a timeout is set, fork a
             * background killer that fires after the deadline. The killer runs
             * concurrently — it doesn't interfere with stream collection.
             *
             * Previous approach raced `process.exitCode` against the timeout
             * *before* collecting streams. This consumed process state and
             * caused stdout/stderr to be empty when a timeout was specified
             * (even if the process finished well before the deadline).
             */
            let timedOut = false

            const timeoutFiber =
              input.timeout !== undefined
                ? yield* Effect.sleep(input.timeout).pipe(
                    Effect.andThen(
                      process.isRunning.pipe(
                        Effect.flatMap((running) => {
                          if (running) {
                            timedOut = true
                            return killGracefully
                          }
                          return Effect.void
                        })
                      )
                    ),
                    Effect.catchAll(() => Effect.void),
                    Effect.fork
                  )
                : undefined

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

            // Cancel the timeout killer if it hasn't fired
            if (timeoutFiber) {
              yield* Fiber.interrupt(timeoutFiber)
            }

            return {
              stdout,
              stderr,
              exitCode: code,
              ...(timedOut ? { timedOut: true } : {}),
            } satisfies ExecResult
          })
        ).pipe(Effect.withSpan('Shell.exec'))

      const shell: Shell = { exec }

      // -- Files service --------------------------------------------------

      const readFile = Effect.fn('Files.readFile')(function* (
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

      const writeFile = Effect.fn('Files.writeFile')(function* (
        filePath: string,
        content: string
      ) {
        const resolved = yield* resolvePath(filePath, 'writeFile')

        // Create parent directories automatically
        const dir = path.dirname(resolved)
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'writeFile',
                message: `Failed to create parent directories for: ${filePath}`,
                error,
              })
          )
        )

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

      const glob = Effect.fn('Files.glob')(function* (pattern: string) {
        const g = new Bun.Glob(pattern)
        const entries = yield* Effect.tryPromise({
          try: async () => {
            const results: string[] = []
            for await (const file of g.scan({ cwd: rootDir, dot: false })) {
              results.push(file)
            }
            return results.sort()
          },
          catch: (error) =>
            new SandboxError({
              operation: 'glob',
              message: `Glob failed for pattern: ${pattern}`,
              error,
            }),
        })
        return entries
      })

      const files: Files = { readFile, writeFile, glob }

      return { shell, files } satisfies SandboxSession
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
