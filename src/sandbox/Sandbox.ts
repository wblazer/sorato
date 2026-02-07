/**
 * A Sandbox provides an isolated execution environment for harness runs.
 *
 * The library defines the *trait* — the contract for what a sandbox can do —
 * and ships a trivial `LocalSandbox` that just runs in the current process
 * (no isolation, fine for development). Real isolation (Docker, Firecracker,
 * etc.) is infrastructure-specific and belongs in consumer-land.
 *
 * The top-level `Sandbox` tag is a *factory* — it produces isolated
 * `SandboxSession` instances per-scenario. Each session is scoped so that
 * cleanup (temp dirs, containers, etc.) happens automatically when the
 * scope closes.
 *
 * The sandbox is the boundary through which tools interact with the outside
 * world. A `Bash` tool, for instance, would call `session.exec(...)` rather
 * than spawning a process directly. This indirection is what makes it possible
 * to swap local dev for containerized CI without touching the tools themselves.
 */
import { Context, Effect, Layer, Schema, Scope, Stream } from 'effect'
import { Command, CommandExecutor } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SandboxError extends Schema.TaggedError<SandboxError>()(
  'SandboxError',
  {
    operation: Schema.String,
    message: Schema.String,
    error: Schema.optional(Schema.Defect),
  }
) {}

// ---------------------------------------------------------------------------
// ExecResult
// ---------------------------------------------------------------------------

/** Structured result from executing a command in a sandbox. */
export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

// ---------------------------------------------------------------------------
// SandboxSession — per-scenario isolated environment
// ---------------------------------------------------------------------------

/** The session interface that any Sandbox implementation must satisfy. */
export interface SandboxSession {
  /** Execute a shell command and return a structured result. */
  readonly exec: (command: string) => Effect.Effect<ExecResult, SandboxError>

  /** Read a file from the sandbox filesystem. */
  readonly readFile: (path: string) => Effect.Effect<string, SandboxError>

  /** Write a file to the sandbox filesystem. */
  readonly writeFile: (
    path: string,
    content: string
  ) => Effect.Effect<void, SandboxError>
}

// ---------------------------------------------------------------------------
// SandboxFactory — produces scoped sessions
// ---------------------------------------------------------------------------

/** Factory that produces isolated SandboxSession instances. */
export interface SandboxFactory {
  /** Acquire a new sandbox session. Cleanup runs when the Scope closes. */
  readonly acquire: Effect.Effect<SandboxSession, SandboxError, Scope.Scope>
}

export class Sandbox extends Context.Tag('@blazerbench/Sandbox')<
  Sandbox,
  SandboxFactory
>() {}

// ---------------------------------------------------------------------------
// LocalSandbox — runs in the current process, no isolation
// ---------------------------------------------------------------------------

/** Collect a Uint8Array stream into a single string. */
const streamToString = <E>(
  stream: Stream.Stream<Uint8Array, E>
): Effect.Effect<string, E> => stream.pipe(Stream.decodeText(), Stream.mkString)

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
