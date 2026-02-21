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
// Exec
// ---------------------------------------------------------------------------

/** Structured result from executing a command in a sandbox. */
export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  /** True when the command was killed due to timeout. */
  readonly timedOut?: boolean | undefined
}

/** Structured command input for sandbox execution. */
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

// ---------------------------------------------------------------------------
// SandboxSession — per-scenario isolated environment
// ---------------------------------------------------------------------------

/** The session interface that any Sandbox implementation must satisfy. */
export interface SandboxSession {
  /** Execute a command and return a structured result. */
  readonly exec: (
    command: ExecCommand
  ) => Effect.Effect<ExecResult, SandboxError>

  /** Read a file from the sandbox filesystem (path is sandbox-relative). */
  readonly readFile: (path: string) => Effect.Effect<string, SandboxError>

  /** Write a file to the sandbox filesystem (path is sandbox-relative). */
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

// ---------------------------------------------------------------------------
// Context Tags
// ---------------------------------------------------------------------------

/**
 * The per-scenario sandbox session. Tools require this in their `R` parameter
 * to delegate operations (exec, readFile, writeFile) into the sandbox.
 *
 * The runner provides this — it acquires a session from the SandboxFactory
 * and layers it into the scope before running the harness.
 */
export class CurrentSandbox extends Context.Tag('@agents/CurrentSandbox')<
  CurrentSandbox,
  SandboxSession
>() {}

/**
 * The sandbox factory — produces scoped SandboxSession instances.
 * The runner uses this to acquire sessions per scenario.
 */
export class Sandbox extends Context.Tag('@agents/Sandbox')<
  Sandbox,
  SandboxFactory
>() {}
