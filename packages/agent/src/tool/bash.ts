/**
 * Bash tool — execute shell commands through the sandbox.
 *
 * The tool handles LLM-facing concerns: output truncation (so a `find /`
 * doesn't blow the context window), spillover to a sandbox file (so the
 * full output is still accessible via ReadFile), and timeout messaging.
 *
 * Security and process management are sandbox concerns — the tool just
 * calls `session.exec()` and formats the result.
 */
import { Tool } from 'effect/unstable/ai'
import { Effect, Match, Schema } from 'effect'
import { CurrentShell, CurrentFiles, SandboxError } from '../sandbox/sandbox.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout in milliseconds (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000

/** Max lines before truncation. */
const MAX_LINES = 2000

/** Max bytes before truncation (50 KB). */
const MAX_BYTES = 50 * 1024

/** Directory inside the sandbox where spillover files are written. */
const SPILLOVER_DIR = '.bash-output'

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

interface TruncationResult {
  /** The (possibly truncated) text to return to the LLM. */
  readonly text: string
  /** Total line count of the original output. */
  readonly totalLines: number
  /** Total byte count of the original output. */
  readonly totalBytes: number
  /** Whether any truncation occurred. */
  readonly truncated: boolean
}

/**
 * Truncate output keeping the tail (most recent output), since that's
 * where errors and results tend to be. Respects both line and byte limits.
 */
const truncateOutput = (output: string): TruncationResult => {
  const totalBytes = Buffer.byteLength(output, 'utf8')
  const lines = output.split('\n')
  const totalLines = lines.length

  return Match.value(totalLines <= MAX_LINES && totalBytes <= MAX_BYTES).pipe(
    Match.when(true, () => ({
      text: output,
      totalLines,
      totalBytes,
      truncated: false,
    })),
    Match.orElse(() => {
      // Take from the tail, respecting both limits
      const kept: string[] = []
      let bytes = 0

      for (const line of [...lines].reverse()) {
        const lineBytes = Buffer.byteLength(line, 'utf8') + 1 // +1 for newline
        if (kept.length >= MAX_LINES || bytes + lineBytes > MAX_BYTES) break
        kept.unshift(line)
        bytes += lineBytes
      }

      return {
        text: kept.join('\n'),
        totalLines,
        totalBytes,
        truncated: true,
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Bash — tool declaration
// ---------------------------------------------------------------------------

export const Bash = Tool.make('Bash', {
  description:
    'Execute a shell command in the sandbox. Returns combined stdout and stderr. Use the `cwd` parameter instead of `cd dir && ...`. Commands run non-interactively — pagers, editors, and prompts are suppressed.',
  parameters: Schema.Struct({
    command: Schema.String.annotate({
      description: 'The shell command to execute (passed to /bin/sh -c).',
    }),
    cwd: Schema.optional(Schema.String).annotate({
      description:
        'Working directory (sandbox-relative). Defaults to the sandbox root.',
    }),
    timeout: Schema.optional(Schema.Number).annotate({
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}ms (${DEFAULT_TIMEOUT_MS / 1000}s). Use a longer timeout for builds/tests.`,
    }),
    description: Schema.optional(Schema.String).annotate({
      description:
        'Brief (5-10 word) description of what this command does, for logging.',
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentShell, CurrentFiles],
})

// ---------------------------------------------------------------------------
// Bash — handler
// ---------------------------------------------------------------------------

export const BashHandler = {
  Bash: ({
    command,
    cwd,
    timeout,
    description: _description,
  }: {
    readonly command: string
    readonly cwd?: string | undefined
    readonly timeout?: number | undefined
    readonly description?: string | undefined
  }) =>
    Effect.gen(function* () {
      const shell = yield* CurrentShell
      const files = yield* CurrentFiles

      const timeoutMs = yield* Effect.filterOrFail(
        Effect.succeed(timeout ?? DEFAULT_TIMEOUT_MS),
        (milliseconds) => milliseconds > 0,
        () =>
          new SandboxError({
            operation: 'Bash',
            message: 'timeout must be a positive number of milliseconds.',
          })
      )

      const result = yield* shell.exec({
        command,
        cwd,
        timeout: timeoutMs,
      })

      // Combine stdout + stderr (stderr after stdout, like a terminal)
      const combined = [result.stdout, result.stderr]
        .filter((s) => s.length > 0)
        .join('\n')

      const truncation = truncateOutput(combined)

      // If truncated, spill the full output to a sandbox file so the LLM
      // can access it via ReadFile
      const spilloverCandidate = `${SPILLOVER_DIR}/${Date.now().toString(36)}.txt`
      const spilloverPath = Match.value(truncation.truncated).pipe(
        Match.when(true, () => spilloverCandidate),
        Match.orElse(() => undefined)
      )
      const writeSpillover = Effect.catch(
        files.writeFile(spilloverCandidate, combined),
        () => Effect.void
      )
      const spilloverCondition = Effect.succeed(truncation.truncated)
      const maybeWriteSpillover = writeSpillover.pipe(
        Effect.when(spilloverCondition)
      )

      yield* maybeWriteSpillover

      // Build the result message
      const parts: string[] = []

      // Exit code (only show if non-zero or timed out — reduce noise)
      result.exitCode !== 0 && parts.push(`Exit code: ${result.exitCode}`)

      result.timedOut &&
        parts.push(`Command timed out after ${timeoutMs / 1000}s and was killed.`)

      // Output
      const outputLines = [truncation.text]
      truncation.text.length === 0 &&
        !result.timedOut &&
        outputLines.splice(0, 1, '(no output)')
      const [outputText = ''] = outputLines
      parts.push(outputText)

      // Truncation notice
      const keptLines = truncation.text.split('\n').length
      truncation.truncated &&
        spilloverPath !== undefined &&
        parts.push(
          `\n[Output truncated — showing last ${keptLines} of ${truncation.totalLines} lines (${truncation.totalBytes} bytes total). Full output: ReadFile path="${spilloverPath}"]`
        )

      return parts.join('\n')
    }),
}
