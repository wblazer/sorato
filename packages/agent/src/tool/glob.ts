/**
 * Glob tool — find files by pattern through the sandbox.
 *
 * Delegates to `files.glob()` and formats the result for the LLM.
 * Supports standard glob syntax: `*` (any chars within a segment),
 * `**` (any directory depth), `?` (single char), `{a,b}` (alternatives).
 *
 * Results are capped to prevent context window explosions on overly broad
 * patterns. When truncated, the LLM gets a hint to narrow the pattern.
 */
import { Tool } from 'effect/unstable/ai'
import { Effect, Option, Match, Schema } from 'effect'
import { CurrentFiles, SandboxError } from '../sandbox/sandbox.ts'

const formatMatchesOutput = (matches: ReadonlyArray<string>): string => {
  const shown = matches.slice(0, MAX_RESULTS)
  const result = shown.join('\n')
  const summary = Match.value(matches.length > MAX_RESULTS).pipe(
    Match.when(
      true,
      () =>
        `(Showing ${MAX_RESULTS} of ${matches.length} matches. Narrow your pattern for complete results.)`
    ),
    Match.orElse(() => `(${matches.length} files)`)
  )

  return `${result}\n\n${summary}`
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file paths returned before truncation. */
const MAX_RESULTS = 500

// ---------------------------------------------------------------------------
// Glob — tool declaration
// ---------------------------------------------------------------------------

export const Glob = Tool.make('Glob', {
  description:
    'Find files matching a glob pattern. Returns matching file paths sorted alphabetically. Supports standard glob syntax: * (any segment chars), ** (any directory depth), ? (single char), {a,b} (alternatives). Example patterns: "**/*.ts", "src/**/*.json", "*.md".',
  parameters: Schema.Struct({
    pattern: Schema.String.annotate({
      description:
        'Glob pattern to match against. Evaluated from the sandbox root (or from `path` if provided). Examples: "**/*.ts", "src/**/*.json", "*.md".',
    }),
    path: Schema.optional(Schema.String).annotate({
      description:
        'Optional base directory to search within (sandbox-relative). The pattern is evaluated relative to this directory. Defaults to the sandbox root.',
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentFiles],
})

// ---------------------------------------------------------------------------
// Glob — handler
// ---------------------------------------------------------------------------

export const GlobHandler = {
  Glob: ({
    pattern,
    path,
  }: {
    readonly pattern: string
    readonly path?: string | undefined
  }) =>
    Effect.gen(function* () {
      const files = yield* CurrentFiles

      // If a base path is provided, scope the pattern under it
      const effectivePattern = Option.fromUndefinedOr(path).pipe(
        Option.match({
          onNone: () => pattern,
          onSome: (basePath) => `${basePath.replace(/\/+$/, '')}/${pattern}`,
        })
      )

      const matches = yield* files.glob(effectivePattern)

      return Match.value(matches.length === 0).pipe(
        Match.when(
          true,
          () => `No files matched the pattern: ${effectivePattern}`
        ),
        Match.orElse(() => formatMatchesOutput(matches))
      )
    }),
}
