/**
 * Sandbox — isolated execution environment for agent tool calls.
 *
 * The sandbox provides two fine-grained services:
 *
 * - **Shell** — execute commands (process spawning, kill mechanics, timeout)
 * - **Files** — read and write files (path resolution, isolation)
 *
 * Tools declare dependencies on the specific services they need. A file
 * editing tool depends on `Files`. A bash tool depends on `Shell` and `Files`.
 * A game-state tool would depend on neither — it'd define its own service.
 * The harness is agnostic; Effect's `R` type propagates requirements
 * automatically and catches incompatible compositions at compile time.
 *
 * The top-level `Sandbox` tag is a *factory* — it acquires a scoped
 * environment and returns the services backed by that environment. Cleanup
 * (temp dirs, containers, etc.) happens automatically when the scope closes.
 *
 * The factory returns `{ shell, files }` — consumers destructure and provide
 * the tags separately. This keeps lifecycle management unified (one scope,
 * one rootDir) while giving tools granular `R` types.
 */
import { Context, Effect, Schema, Scope } from 'effect'

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
// Shell — command execution service
// ---------------------------------------------------------------------------

/** Structured result from executing a command. */
export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  /** True when the command was killed due to timeout. */
  readonly timedOut?: boolean | undefined
}

/** Structured command input for execution. */
export interface ExecCommand {
  /** Shell command string (passed to the sandbox's shell). */
  readonly command: string
  /** Working directory (sandbox-relative; absolute paths are sandbox-relative). */
  readonly cwd?: string | undefined
  /** Environment variables to inject for this command. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** UTF-8 stdin payload. */
  readonly stdin?: string | undefined
  /**
   * Timeout in milliseconds. When exceeded, the sandbox kills the process
   * (and its children) and returns whatever output was captured so far.
   * The `ExecResult.timedOut` flag will be set.
   *
   * Implementations should use graceful kill escalation (SIGTERM → SIGKILL).
   */
  readonly timeout?: number | undefined
}

/** Shell service — execute commands in the sandbox. */
export interface Shell {
  readonly exec: (
    command: ExecCommand
  ) => Effect.Effect<ExecResult, SandboxError>
}

/** Per-scenario shell service. Tools that execute commands require this in their `R`. */
export class CurrentShell extends Context.Tag('@agents/Shell')<
  CurrentShell,
  Shell
>() {}

// ---------------------------------------------------------------------------
// Files — filesystem service
// ---------------------------------------------------------------------------

/** Files service — read and write files in the sandbox. */
export interface Files {
  /** Read a file from the sandbox filesystem (path is sandbox-relative). */
  readonly readFile: (path: string) => Effect.Effect<string, SandboxError>

  /**
   * Write a file to the sandbox filesystem (path is sandbox-relative).
   * Implementations should create parent directories automatically.
   */
  readonly writeFile: (
    path: string,
    content: string
  ) => Effect.Effect<void, SandboxError>

  /**
   * Find files matching a glob pattern (evaluated from sandbox root).
   * Returns sandbox-relative paths, sorted alphabetically.
   */
  readonly glob: (
    pattern: string
  ) => Effect.Effect<ReadonlyArray<string>, SandboxError>
}

/** Per-scenario files service. Tools that access files require this in their `R`. */
export class CurrentFiles extends Context.Tag('@agents/Files')<
  CurrentFiles,
  Files
>() {}

// ---------------------------------------------------------------------------
// SandboxSession — the composite returned by the factory
// ---------------------------------------------------------------------------

/** What the factory returns — consumers destructure and provide tags separately. */
export interface SandboxSession {
  readonly shell: Shell
  readonly files: Files
}

// ---------------------------------------------------------------------------
// SandboxFactory — produces scoped sessions
// ---------------------------------------------------------------------------

/** Factory that produces isolated sandbox sessions. */
export interface SandboxFactory {
  /**
   * Acquire a new sandbox session rooted at the given directory.
   *
   * The sandbox uses `directory` as-is — it does not create or clean up
   * directories. Lifecycle management is the caller's responsibility.
   */
  readonly acquire: (
    directory: string
  ) => Effect.Effect<SandboxSession, SandboxError, Scope.Scope>
}

// ---------------------------------------------------------------------------
// Context Tags
// ---------------------------------------------------------------------------

/**
 * The sandbox factory — produces scoped sessions with Shell + Files services.
 * The runner uses this to acquire sessions per scenario.
 */
export class Sandbox extends Context.Tag('@agents/Sandbox')<
  Sandbox,
  SandboxFactory
>() {}
