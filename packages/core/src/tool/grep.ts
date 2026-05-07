/**
 * Grep tool — search file contents by regex through the sandbox.
 *
 * Shells out to `rg` (ripgrep) and formats results for the LLM.
 * Results are sorted by file modification time (most recent first) so
 * the model sees recently-touched code before alphabetical noise.
 * Capped at {@link MAX_MATCHES} to prevent context window explosions.
 *
 * Requires `rg` to be installed in the sandbox environment. Fails
 * explicitly if it's missing — no silent downloads, no fallbacks.
 */
import { Tool } from 'effect/unstable/ai'
import { Effect, Match, Schema } from 'effect'
import { CurrentShell, SandboxError } from '../sandbox/sandbox.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum individual matches returned before truncation. */
const MAX_MATCHES = 100

/** Maximum characters per matched line (rg truncates beyond this). */
const MAX_LINE_LENGTH = 1024

/** Timeout for the rg subprocess (30 s — generous for large repos). */
const TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Shell escaping
// ---------------------------------------------------------------------------

/**
 * Escape a value for safe interpolation into a shell command string.
 * Wraps in single quotes unless the value is trivially safe.
 */
const shellEscape = (arg: string): string => {
  if (/^[a-zA-Z0-9._\-/=:@]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, "'\\''")}'`
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

interface GrepMatch {
  readonly filePath: string
  readonly lineNum: number
  readonly lineText: string
}

/**
 * Parse ripgrep output into structured matches.
 *
 * Expected format per line: `<path>|<lineNum>|<text>`.
 * The `|` separator (via `--field-match-separator`) avoids the classic
 * `:` collision with Windows drive letters and matched content.
 * We rejoin on `|` past the second separator in case the text itself
 * contains pipes.
 */
const parseMatches = (output: string): Array<GrepMatch> => {
  const lines = output.trim().split(/\r?\n/)
  const matches: Array<GrepMatch> = []

  for (const line of lines) {
    if (line.length === 0) continue

    const firstSep = line.indexOf('|')
    if (firstSep === -1) continue

    const secondSep = line.indexOf('|', firstSep + 1)
    if (secondSep === -1) continue

    const filePath = line.slice(0, firstSep)
    const lineNumStr = line.slice(firstSep + 1, secondSep)
    const lineText = line.slice(secondSep + 1)

    const lineNum = parseInt(lineNumStr, 10)
    if (Number.isNaN(lineNum)) continue

    matches.push({ filePath, lineNum, lineText })
  }

  return matches
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * Group matches by file and format for the LLM:
 *
 * ```
 * Found 42 matches
 *
 * path/to/file.ts:
 *   12: const foo = bar
 *   45: export function baz
 *
 * path/to/other.ts:
 *   7: import { grep } from "./grep"
 * ```
 */
const formatOutput = (
  matches: ReadonlyArray<GrepMatch>,
  totalCount: number,
  exitCode: number
): string => {
  const parts: string[] = []

  // Group by file, preserving order (already mtime-sorted by rg)
  let currentFile = ''
  for (const match of matches) {
    match.filePath !== currentFile && currentFile !== '' && parts.push('')
    match.filePath !== currentFile && parts.push(`${match.filePath}:`)
    currentFile = match.filePath
    parts.push(`  ${match.lineNum}: ${match.lineText}`)
  }

  const matchWord = Match.value(totalCount === 1).pipe(
    Match.when(true, () => 'match'),
    Match.orElse(() => 'matches')
  )
  const header = `Found ${totalCount} ${matchWord}`

  const body = parts.join('\n')

  const notices: string[] = []

  matches.length < totalCount &&
    notices.push(
      `(Showing ${matches.length} of ${totalCount} matches. Use a more specific pattern or path to narrow results.)`
    )

  exitCode === 2 && notices.push('(Some paths were inaccessible and skipped.)')

  const suffixes = ['']
  notices.length > 0 && suffixes.splice(0, 1, `\n\n${notices.join('\n')}`)
  const [suffix] = suffixes

  return `${header}\n\n${body}${suffix}`
}

// ---------------------------------------------------------------------------
// Grep — tool declaration
// ---------------------------------------------------------------------------

export const Grep = Tool.make('Grep', {
  description:
    'Search file contents using a regex pattern. Returns matching file paths and line numbers, sorted by modification time (most recently modified files first). Supports full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Use `include` to filter by file type (e.g. "*.ts", "*.{js,jsx}").',
  parameters: Schema.Struct({
    pattern: Schema.String.annotate({
      description: 'The regex pattern to search for in file contents.',
    }),
    path: Schema.optionalKey(Schema.String).annotate({
      description:
        'Directory to search in (sandbox-relative). Defaults to the sandbox root.',
    }),
    include: Schema.optionalKey(Schema.String).annotate({
      description:
        'Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}"). Only files matching this pattern will be searched.',
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentShell],
})

// ---------------------------------------------------------------------------
// Grep — handler
// ---------------------------------------------------------------------------

export const GrepHandler = {
  Grep: ({
    pattern,
    path,
    include,
  }: {
    readonly pattern: string
    readonly path?: string | undefined
    readonly include?: string | undefined
  }) =>
    Effect.gen(function* () {
      const shell = yield* CurrentShell

      const trimmedPattern = yield* Effect.filterOrFail(
        Effect.succeed(pattern.trim()),
        (value) => value.length > 0,
        () =>
          new SandboxError({
            operation: 'Grep',
            message: 'Pattern must not be empty.',
          })
      )

      // Build the rg invocation
      const args = [
        'rg',
        '-nH', // line numbers + filenames
        '--hidden', // search dotfiles (.github, .env.example, etc.)
        '--no-messages', // suppress broken-symlink warnings etc.
        '--field-match-separator=|',
        `--max-columns=${MAX_LINE_LENGTH}`,
        '--max-columns-preview', // truncate long lines instead of omitting
        '--sortr=modified', // most recently modified files first
        '--regexp',
        trimmedPattern,
      ]

      include && args.push('--glob', include)

      args.push(path ?? '.')

      const result = yield* shell.exec({
        command: args.map(shellEscape).join(' '),
        timeout: TIMEOUT_MS,
      })

      const summarizeOutput = (exitCode: number) => {
        const allMatches = parseMatches(result.stdout)
        const totalCount = allMatches.length
        const shown = allMatches.slice(0, MAX_MATCHES)
        return Match.value(result.stdout.trim().length > 0).pipe(
          Match.when(true, () => formatOutput(shown, totalCount, exitCode)),
          Match.orElse(() => 'No matches found.')
        )
      }

      const failureMessages = [
        `ripgrep failed (exit ${result.exitCode}): ${result.stderr}`,
      ]
      const isNotInstalled =
        result.stderr.includes('not found') ||
        result.stderr.includes('No such file or directory')

      isNotInstalled &&
        failureMessages.splice(
          0,
          1,
          'ripgrep (rg) is not available in the sandbox environment. Install it to use the Grep tool.'
        )
      const [failureMessage = 'ripgrep failed.'] = failureMessages

      const parsedMatches = parseMatches(result.stdout)
      const logGrepResult =
        result.exitCode === 0 || result.exitCode === 1
          ? Effect.logDebug
          : Effect.logWarning
      yield* logGrepResult('Grep tool completed search', {
        path: path ?? '.',
        include,
        exitCode: result.exitCode,
        matchCount: parsedMatches.length,
        truncated: parsedMatches.length > MAX_MATCHES,
      })

      return yield* Match.value(result.exitCode).pipe(
        Match.when(1, () => Effect.succeed('No matches found.')),
        Match.when(0, () => Effect.succeed(summarizeOutput(0))),
        Match.when(2, () => Effect.succeed(summarizeOutput(2))),
        Match.orElse(() =>
          Effect.fail(
            new SandboxError({
              operation: 'Grep',
              message: failureMessage,
            })
          )
        )
      )
    }).pipe(
      Effect.annotateLogs({ package: 'core', subsystem: 'tool', tool: 'Grep' }),
      Effect.withLogSpan('tool.Grep')
    ),
}
