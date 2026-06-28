/**
 * LocalSandbox — runs in the current process, no isolation.
 *
 * Uses Effect's ChildProcess and FileSystem services for process +
 * filesystem operations. The caller provides a root directory; all paths
 * are resolved under it. The sandbox does not create or clean up
 * directories — lifecycle management is the caller's responsibility.
 * `LocalSandboxLive` is a convenience layer with Bun services already wired in.
 */
import { Effect, Fiber, Layer, Match, Option, Ref, Stream } from 'effect'
import { FileSystem, Path } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { BunServices } from '@effect/platform-bun'
import {
  Sandbox,
  SandboxError,
  type ExecCommand,
  type ExecResult,
  type Shell,
  type Files,
  type SandboxFactory,
  type SandboxSession,
} from './sandbox.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect a Uint8Array stream into a single string. */
const streamToString = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString)

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

export const LocalSandbox = Layer.effect(Sandbox)(
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const doAcquire = Effect.fn('Sandbox.acquire')(function* (
      directory: string
    ) {
      const rootDir = directory
      yield* Effect.logInfo('Local sandbox acquired', { directory: rootDir })

      function validateResolvedPath(
        resolved: string,
        target: string,
        operation: string
      ) {
        const relativeToRoot = path.relative(rootDir, resolved)
        return Match.value(
          relativeToRoot === '' ||
            (!relativeToRoot.startsWith(`..${path.sep}`) &&
              relativeToRoot !== '..' &&
              !path.isAbsolute(relativeToRoot))
        ).pipe(
          Match.when(true, () => Effect.succeed(resolved)),
          Match.orElse(() =>
            Effect.fail(
              new SandboxError({
                operation,
                message: `Path escapes sandbox root: ${target}`,
              })
            )
          )
        )
      }

      const resolvePath = (target: string, operation: string) => {
        const relative = Match.value(path.isAbsolute(target)).pipe(
          Match.when(true, () => target.replace(/^\/+/, '')),
          Match.orElse(() => target)
        )
        const resolved = path.resolve(rootDir, relative)
        return validateResolvedPath(resolved, target, operation)
      }

      // -- Shell service --------------------------------------------------

      const exec = Effect.fn('Shell.exec')(function* (input: ExecCommand) {
        const cwd = yield* Match.value(input.cwd).pipe(
          Match.when(undefined, () => Effect.succeed(rootDir)),
          Match.orElse((workingDirectory) =>
            resolvePath(workingDirectory, 'exec')
          )
        )

        // Merge non-interactive defaults under user env (user wins)
        const mergedEnv: Record<string, string | undefined> = {
          ...NON_INTERACTIVE_ENV,
          ...input.env,
        }
        const stdin = Match.value(input.stdin).pipe(
          Match.when(undefined, () => undefined),
          Match.orElse((content) =>
            Stream.succeed(new TextEncoder().encode(content))
          )
        )

        yield* Effect.logDebug('Local sandbox command starting', {
          cwd,
          timeoutMs: input.timeout,
          commandLength: input.command.length,
          hasStdin: input.stdin !== undefined,
        })

        const command = ChildProcess.make('/bin/sh', ['-c', input.command], {
          cwd,
          env: mergedEnv,
          extendEnv: true,
          stdin,
        })
        const process = yield* childProcessSpawner.spawn(command).pipe(
          Effect.mapError(
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
        const killGracefully = Effect.catch(
          process.kill({
            killSignal: 'SIGTERM',
            forceKillAfter: `${KILL_GRACE_MS} millis`,
          }),
          () => Effect.void
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
        const timedOutRef = yield* Ref.make(false)
        const markTimedOutAndKill = Effect.andThen(
          Ref.set(timedOutRef, true),
          killGracefully
        )
        const maybeKillRunningProcess = Effect.when(
          markTimedOutAndKill,
          process.isRunning
        )
        const timeoutAction = maybeKillRunningProcess.pipe(Effect.asVoid)
        const interruptCleanup = maybeKillRunningProcess.pipe(
          Effect.catch(() => Effect.void)
        )
        const timeoutProgram = Option.map(
          Option.fromNullishOr(input.timeout),
          (timeout) =>
            Effect.sleep(timeout).pipe(
              Effect.andThen(timeoutAction),
              Effect.catch(() => Effect.void)
            )
        )
        const timeoutFiber = yield* Option.getOrElse(
          Option.map(timeoutProgram, (program) =>
            Effect.forkChild(program).pipe(Effect.map(Option.some))
          ),
          () => Effect.succeed(Option.none())
        )

        const [stdout, stderr, code] = yield* Effect.all([
          streamToString(process.stdout),
          streamToString(process.stderr),
          process.exitCode,
        ] as const).pipe(
          Effect.ensuring(interruptCleanup),
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'exec',
                message: `Failed to execute command: ${input.command}`,
                error,
              })
          )
        )

        yield* Option.match(timeoutFiber, {
          onNone: () => Effect.void,
          onSome: Fiber.interrupt,
        })

        const timedOut = yield* Ref.get(timedOutRef)
        const result = {
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: Number(code),
        }

        const logExecResult = Match.value(
          timedOut || result.exitCode !== 0
        ).pipe(
          Match.when(true, () => Effect.logWarning),
          Match.orElse(() => Effect.logDebug)
        )
        yield* logExecResult('Local sandbox command completed', {
          cwd,
          exitCode: result.exitCode,
          timedOut,
          stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
          stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
        })

        return Match.value(timedOut).pipe(
          Match.when(
            true,
            () => ({ ...result, timedOut: true }) satisfies ExecResult
          ),
          Match.orElse(() => result satisfies ExecResult)
        )
      }, Effect.scoped)

      const shell: Shell = {
        exec: (input) =>
          exec(input).pipe(
            Effect.annotateLogs({ package: 'core', subsystem: 'sandbox' }),
            Effect.withLogSpan('sandbox.exec')
          ),
      }

      // -- Files service --------------------------------------------------

      const doReadFile = Effect.fn('Files.readFile')(function* (
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

        yield* Effect.filterOrFail(
          Effect.succeed(exists),
          (value) => value,
          () =>
            new SandboxError({
              operation: 'readFile',
              message: `File not found: ${filePath}`,
            })
        )

        const content = yield* fs.readFileString(resolved).pipe(
          Effect.mapError(
            (error) =>
              new SandboxError({
                operation: 'readFile',
                message: `Failed to read file: ${filePath}`,
                error,
              })
          )
        )
        yield* Effect.logDebug('Local sandbox read file', {
          path: filePath,
          bytes: Buffer.byteLength(content, 'utf8'),
        })
        return content
      })
      const readFile: Files['readFile'] = (filePath) =>
        doReadFile(filePath).pipe(
          Effect.annotateLogs({ package: 'core', subsystem: 'sandbox' }),
          Effect.withLogSpan('sandbox.readFile')
        )

      const doWriteFile = Effect.fn('Files.writeFile')(function* (
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
        yield* Effect.logDebug('Local sandbox wrote file', {
          path: filePath,
          bytes: Buffer.byteLength(content, 'utf8'),
        })
      })
      const writeFile: Files['writeFile'] = (filePath, content) =>
        doWriteFile(filePath, content).pipe(
          Effect.annotateLogs({ package: 'core', subsystem: 'sandbox' }),
          Effect.withLogSpan('sandbox.writeFile')
        )

      const doGlob = Effect.fn('Files.glob')(function* (pattern: string) {
        const g = new Bun.Glob(pattern)
        async function collectEntries() {
          const results: string[] = []
          for await (const file of g.scan({ cwd: rootDir, dot: false })) {
            results.push(file)
          }
          return results.sort()
        }
        const entries = yield* Effect.tryPromise({
          try: collectEntries,
          catch: (error) =>
            new SandboxError({
              operation: 'glob',
              message: `Glob failed for pattern: ${pattern}`,
              error,
            }),
        })
        yield* Effect.logDebug('Local sandbox glob completed', {
          pattern,
          matchCount: entries.length,
        })
        return entries
      })
      const glob: Files['glob'] = (pattern) =>
        doGlob(pattern).pipe(
          Effect.annotateLogs({ package: 'core', subsystem: 'sandbox' }),
          Effect.withLogSpan('sandbox.glob')
        )

      const files: Files = { readFile, writeFile, glob }

      return { shell, files } satisfies SandboxSession
    })

    const acquire: SandboxFactory['acquire'] = (directory) =>
      doAcquire(directory).pipe(
        Effect.annotateLogs({ package: 'core', subsystem: 'sandbox' }),
        Effect.withLogSpan('sandbox.acquire')
      )

    return { acquire }
  })
)

/**
 * Convenience layer that provides LocalSandbox with Bun's platform services
 * already wired in. Use this in scripts/tests where you want zero setup.
 */
export const LocalSandboxLive = LocalSandbox.pipe(
  Layer.provide(BunServices.layer)
)
