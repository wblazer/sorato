/**
 * Hashline tool pair — ReadFile + EditFile that share the hashline protocol.
 *
 * ReadFile returns lines annotated with content hashes:
 *   `<line>:<hash>|<content>`
 *
 * EditFile accepts edits that reference lines by `<line>:<hash>` anchors.
 * If a hash doesn't match the current file content, the edit is rejected —
 * the model must re-read to get fresh anchors.
 *
 * These two tools are a unit. A different edit strategy (str_replace, patch)
 * would pair with a different read format. That's why they live together.
 */
import { Tool } from 'effect/unstable/ai'
import { Effect, Match, Option, Schema } from 'effect'
import { CurrentFiles, SandboxError } from '../../sandbox/sandbox.ts'
import {
  encode,
  hashLine,
  HASH_LENGTH,
  parseAnchor,
  resolveAnchor,
} from './encoding.ts'

// ---------------------------------------------------------------------------
// ReadFile — constants
// ---------------------------------------------------------------------------

/** Default max lines returned per read. */
const DEFAULT_LIMIT = 2000

/** Lines longer than this get truncated with `...`. */
const MAX_LINE_LENGTH = 2000

/** Hard byte cap on output — stops emitting lines once exceeded. */
const MAX_BYTES = 50 * 1024

/**
 * Extensions that are always binary. Checked before any byte-level heuristic.
 * Lowercase, with leading dot.
 */
const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.class',
  '.jar',
  '.war',
  '.o',
  '.a',
  '.obj',
  '.lib',
  '.wasm',
  '.pyc',
  '.pyo',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  '.mov',
  '.mkv',
  '.pdf',
])

/** Check if raw file content looks binary (null bytes or >30% non-printable). */
const isBinaryContent = (raw: string): boolean => {
  // Only inspect the first 4096 chars — enough to detect binary signatures.
  const sample = raw.slice(0, 4096)
  let nonPrintable = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    if (code === 0) return true // null byte → definitely binary
    // Printable: tab(9), newline(10), carriage return(13), space(32)+
    nonPrintable += Number(
      code < 32 && code !== 9 && code !== 10 && code !== 13
    )
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.3
}

/** Extract the file extension (lowercase, with dot) from a path. */
const extOf = (path: string): string => {
  const dot = path.lastIndexOf('.')
  const extensions = ['']
  dot !== -1 && extensions.splice(0, 1, path.slice(dot).toLowerCase())
  const [extension = ''] = extensions
  return extension
}

// ---------------------------------------------------------------------------
// ReadFile — tool declaration
// ---------------------------------------------------------------------------

export const ReadFile = Tool.make('ReadFile', {
  description:
    'Read a file. Returns lines annotated with content-hash anchors in the format `<line>:<hash>|<content>`. Use these `<line>:<hash>` anchors when calling EditFile. Supports reading specific line ranges via offset/limit.',
  parameters: Schema.Struct({
    path: Schema.String.annotate({
      description: 'Absolute or relative path to the file',
    }),
    offset: Schema.optionalKey(Schema.Number).annotate({
      description:
        '1-indexed line number to start reading from. Defaults to 1.',
    }),
    limit: Schema.optionalKey(Schema.Number).annotate({
      description: `Maximum number of lines to return. Defaults to ${DEFAULT_LIMIT}.`,
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentFiles],
})

export const ReadFileHandler = {
  ReadFile: ({
    path,
    offset,
    limit,
  }: {
    readonly path: string
    readonly offset?: number | undefined
    readonly limit?: number | undefined
  }) =>
    Effect.gen(function* () {
      const files = yield* CurrentFiles

      // Binary extension check — fast reject before reading content
      yield* Effect.filterOrFail(
        Effect.succeed(path),
        (currentPath) => !BINARY_EXTENSIONS.has(extOf(currentPath)),
        (currentPath) =>
          new SandboxError({
            operation: 'ReadFile',
            message: `Cannot read binary file: ${currentPath}`,
          })
      )

      const content = yield* files.readFile(path)

      // Binary content check — catch files without known extensions
      yield* Effect.filterOrFail(
        Effect.succeed(content),
        (rawContent) => !isBinaryContent(rawContent),
        () =>
          new SandboxError({
            operation: 'ReadFile',
            message: `Cannot read binary file: ${path}`,
          })
      )

      const effectiveOffset = yield* Effect.filterOrFail(
        Effect.succeed(offset ?? 1),
        (value) => value >= 1,
        () =>
          new SandboxError({
            operation: 'ReadFile',
            message: 'offset must be greater than or equal to 1',
          })
      )

      const result = encode(content, {
        offset: effectiveOffset,
        limit: limit ?? DEFAULT_LIMIT,
        maxLineLength: MAX_LINE_LENGTH,
        maxBytes: MAX_BYTES,
      })

      yield* Effect.logDebug('ReadFile tool encoded file', {
        path,
        offset: effectiveOffset,
        limit: limit ?? DEFAULT_LIMIT,
        totalLines: result.totalLines,
        firstLine: effectiveOffset,
        lastLine: result.lastLine,
        truncatedByBytes: result.truncatedByBytes,
      })

      yield* Effect.filterOrFail(
        Effect.succeed(result.totalLines),
        (totalLines) => effectiveOffset <= totalLines,
        (totalLines) =>
          new SandboxError({
            operation: 'ReadFile',
            message: `Offset ${effectiveOffset} is out of range (file has ${totalLines} lines)`,
          })
      )

      // Append a footer so the model knows if there's more to read
      let footer: string
      if (result.truncatedByBytes) {
        footer = `\n(Output truncated at ${MAX_BYTES} bytes. Use offset=${result.lastLine + 1} to continue reading.)`
      } else if (result.lastLine < result.totalLines) {
        footer = `\n(Showing lines ${effectiveOffset}–${result.lastLine} of ${result.totalLines}. Use offset=${result.lastLine + 1} to read more.)`
      } else {
        footer = `\n(End of file — ${result.totalLines} lines total)`
      }

      return result.text + footer
    }).pipe(
      Effect.annotateLogs({ package: 'core', subsystem: 'tool', tool: 'ReadFile' }),
      Effect.withLogSpan('tool.ReadFile')
    ),
}

// ---------------------------------------------------------------------------
// EditFile — schema types
// ---------------------------------------------------------------------------

const AnchorSchema = Schema.String.annotate({
  description:
    'A line anchor in the format "<line>:<hash>" from the last ReadFile output, e.g. "3:0e"',
})

const ContentSchema = Schema.String.annotate({
  description: 'The new content to insert (may contain newlines)',
})

const ReplaceOp = Schema.Struct({
  type: Schema.Literal('replace').annotate({
    description: 'Replace a range of lines (inclusive) with new content',
  }),
  startAnchor: AnchorSchema.annotate({
    description: 'Anchor of the first line to replace',
  }),
  endAnchor: AnchorSchema.annotate({
    description:
      'Anchor of the last line to replace (inclusive). Same as startAnchor for a single-line replace.',
  }),
  content: ContentSchema,
})

const InsertOp = Schema.Struct({
  type: Schema.Literal('insert').annotate({
    description: 'Insert new content after the referenced line',
  }),
  afterAnchor: AnchorSchema.annotate({
    description:
      'Anchor of the line after which to insert. Use "0" to insert at the beginning of the file.',
  }),
  content: ContentSchema,
})

const DeleteOp = Schema.Struct({
  type: Schema.Literal('delete').annotate({
    description: 'Delete a range of lines (inclusive)',
  }),
  startAnchor: AnchorSchema.annotate({
    description: 'Anchor of the first line to delete',
  }),
  endAnchor: AnchorSchema.annotate({
    description:
      'Anchor of the last line to delete (inclusive). Same as startAnchor for a single-line delete.',
  }),
})

const EditOp = Schema.Union([ReplaceOp, InsertOp, DeleteOp])

// ---------------------------------------------------------------------------
// EditFile — tool declaration
// ---------------------------------------------------------------------------

export const EditFile = Tool.make('EditFile', {
  description:
    'Edit a file using line anchors from the last ReadFile output. Each anchor is a `<line>:<hash>` pair that identifies a specific line. You must ReadFile before editing to obtain valid anchors. Edits must not overlap — no two operations can touch the same lines.',
  parameters: Schema.Struct({
    path: Schema.String.annotate({
      description: 'Path to the file (same path used in ReadFile)',
    }),
    edits: Schema.Array(EditOp).annotate({
      description:
        'Array of edit operations. Each operation references lines by their `<line>:<hash>` anchors from the last ReadFile call. Edits must not overlap — no two operations can touch the same lines. Edits are automatically sorted by line position.',
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentFiles],
})

// ---------------------------------------------------------------------------
// EditFile — handler internals
// ---------------------------------------------------------------------------

type EditOpType = typeof EditOp.Type

/** Parse an anchor string and resolve it against the original lines. */
const parseAndResolve = (
  anchorStr: string,
  lines: ReadonlyArray<string>
): { readonly index: number } | { readonly error: string } => {
  const anchor = parseAnchor(anchorStr)

  return Option.fromNullishOr(anchor).pipe(
    Option.match({
      onNone: () => ({
        error: `Invalid anchor format: "${anchorStr}". Expected "<line>:<hash>", e.g. "3:0e"`,
      }),
      onSome: (parsedAnchor) => resolveAnchor(parsedAnchor, lines),
    })
  )
}

/**
 * Strip echoed hashline anchors from content the model provides.
 *
 * Models frequently echo back the `<line>:<hash>|` prefix when providing
 * replacement/insert content. We only strip a prefix when it matches a
 * *real* anchor from the original file — i.e., the line number is in range
 * and the hash matches that line's content. This prevents false positives
 * on data files where a line legitimately starts with `12:a10e|...`.
 */
const ANCHOR_ECHO_RE = new RegExp(`^(\\d+):([0-9a-f]{${HASH_LENGTH}})\\|`)

const stripAnchorEchoes = (
  content: string,
  originalLines: ReadonlyArray<string>
): string =>
  content
    .split('\n')
    .map((line) => stripAnchorEcho(line, originalLines))
    .join('\n')

const stripAnchorEcho = (
  line: string,
  originalLines: ReadonlyArray<string>
): string => {
  const match = ANCHOR_ECHO_RE.exec(line)
  if (!match) return line

  const [, lineNumText = '', hash = ''] = match
  const lineNum = parseInt(lineNumText, 10)
  const idx = lineNum - 1
  const originalLine = originalLines[idx] ?? ''

  // Only strip if the anchor references a real line with a matching hash
  return Match.value(
    idx >= 0 && idx < originalLines.length && hashLine(originalLine) === hash
  ).pipe(
    Match.when(true, () => line.slice(match[0].length)),
    Match.orElse(() => line)
  )
}

/**
 * A resolved edit — anchors have been validated against the original
 * snapshot and converted to 0-based indices. These are what we actually
 * apply to the file.
 *
 * `sortKey` is the original-snapshot index used for ordering and overlap
 * detection. For inserts at the beginning of the file (afterAnchor "0"),
 * it's -1 so it sorts before everything else.
 */
type ResolvedEdit =
  | {
      readonly type: 'replace'
      readonly startIdx: number
      readonly endIdx: number
      readonly content: string
      readonly sortKey: number
    }
  | {
      readonly type: 'insert'
      readonly afterIdx: number // -1 means beginning of file
      readonly content: string
      readonly sortKey: number
    }
  | {
      readonly type: 'delete'
      readonly startIdx: number
      readonly endIdx: number
      readonly sortKey: number
    }

type ResolveResult = ResolvedEdit | { readonly error: string }

/**
 * Resolve a raw edit op against the original lines. Returns a ResolvedEdit
 * with validated 0-based indices, or an error message.
 *
 * Content in replace/insert ops is run through context-aware anchor-echo
 * stripping — only prefixes that match real anchors in the original file
 * are removed.
 */
const resolveOp = (
  op: EditOpType,
  originalLines: ReadonlyArray<string>
): ResolveResult => {
  switch (op.type) {
    case 'replace': {
      const start = parseAndResolve(op.startAnchor, originalLines)
      if ('error' in start) return start
      const end = parseAndResolve(op.endAnchor, originalLines)
      if ('error' in end) return end
      const results: [ResolveResult] = [
        {
          type: 'replace',
          startIdx: start.index,
          endIdx: end.index,
          content: stripAnchorEchoes(op.content, originalLines),
          sortKey: start.index,
        },
      ]

      start.index > end.index &&
        results.splice(0, 1, {
          error: `startAnchor "${op.startAnchor}" is after endAnchor "${op.endAnchor}"`,
        })

      const [result] = results

      return result
    }
    case 'insert': {
      switch (op.afterAnchor) {
        case '0':
          return {
            type: 'insert',
            afterIdx: -1,
            content: stripAnchorEchoes(op.content, originalLines),
            sortKey: -1,
          }
        default: {
          const after = parseAndResolve(op.afterAnchor, originalLines)
          if ('error' in after) return after
          return {
            type: 'insert',
            afterIdx: after.index,
            content: stripAnchorEchoes(op.content, originalLines),
            sortKey: after.index,
          }
        }
      }
    }
    case 'delete': {
      const start = parseAndResolve(op.startAnchor, originalLines)
      if ('error' in start) return start
      const end = parseAndResolve(op.endAnchor, originalLines)
      if ('error' in end) return end
      const results: [ResolveResult] = [
        {
          type: 'delete',
          startIdx: start.index,
          endIdx: end.index,
          sortKey: start.index,
        },
      ]

      start.index > end.index &&
        results.splice(0, 1, {
          error: `startAnchor "${op.startAnchor}" is after endAnchor "${op.endAnchor}"`,
        })

      const [result] = results

      return result
    }
  }
}

/**
 * Sort precedence for tie-breaking when two edits share the same sortKey.
 * Replaces and deletes come before inserts at the same position — this
 * means in bottom-to-top application, the insert is applied first (goes
 * after the replaced/deleted content in the final output).
 */
const sortPrecedence = (edit: ResolvedEdit): number =>
  Number(edit.type === 'insert')

/**
 * Validate that sorted edits don't overlap.
 *
 * "Overlap" means:
 * - Two replace/delete ops touch the same original lines.
 * - An insert's afterIdx falls strictly inside a replaced/deleted range
 *   (the inserted content would be swallowed by the replace/delete).
 *
 * Called AFTER sorting — assumes ascending sortKey order.
 */
const validateNoOverlap = (
  edits: ReadonlyArray<ResolvedEdit>
): Option.Option<string> => {
  // Collect all replaced/deleted ranges for insert validation
  const mutatedRanges: Array<[number, number]> = []
  let lastEnd = -1

  for (const edit of edits) {
    switch (edit.type) {
      case 'replace':
      case 'delete': {
        const start = edit.startIdx
        const end = edit.endIdx
        switch (start <= lastEnd) {
          case true:
            return Option.some(
              `Edits overlap: an edit touches line ${start + 1}, which was already modified by a previous edit.`
            )
          case false:
            break
        }
        lastEnd = end
        mutatedRanges.push([start, end])
        break
      }
      case 'insert':
        break
    }
  }

  // Check that inserts don't land inside a mutated range
  for (const edit of edits) {
    if (edit.type !== 'insert') continue
    const afterIdx = edit.afterIdx // -1 for BOF is safe — no range starts at -1
    for (const [start, end] of mutatedRanges) {
      switch (afterIdx >= start && afterIdx < end) {
        case true:
          return Option.some(
            `Insert after line ${afterIdx + 1} conflicts with a replace/delete spanning lines ${start + 1}–${end + 1}. The inserted content would be lost.`
          )
        case false:
          break
      }
    }
  }

  return Option.none()
}

// ---------------------------------------------------------------------------
// EditFile — handler
// ---------------------------------------------------------------------------

export const EditFileHandler = {
  EditFile: ({
    path,
    edits,
  }: {
    readonly path: string
    readonly edits: ReadonlyArray<EditOpType>
  }) =>
    Effect.gen(function* () {
      const files = yield* CurrentFiles
      const content = yield* files.readFile(path)
      const originalLines = content.split('\n')
      yield* Effect.logInfo('EditFile tool resolving edits', {
        path,
        editCount: edits.length,
        originalLines: originalLines.length,
      })

      // Phase 1: Resolve all anchors against the original snapshot
      const resolved: Array<ResolvedEdit> = []
      for (const op of edits) {
        const result = resolveOp(op, originalLines)
        yield* Match.value(result).pipe(
          Match.when(
            { error: Match.string },
            ({ error }) =>
              new SandboxError({
                operation: 'EditFile',
                message: error,
              })
          ),
          Match.orElse((resolvedEdit) =>
            Effect.sync(() => {
              resolved.push(resolvedEdit)
            })
          )
        )
      }

      // Phase 2: Sort by position (ascending), with tie-breaker:
      // replaces/deletes before inserts at the same position.
      resolved.sort(
        (a, b) => a.sortKey - b.sortKey || sortPrecedence(a) - sortPrecedence(b)
      )

      // Phase 3: Validate non-overlap (after sorting)
      const overlapError = validateNoOverlap(resolved)
      yield* overlapError.pipe(
        Option.match({
          onNone: () => Effect.void,
          onSome: (message) =>
            Effect.fail(
              new SandboxError({
                operation: 'EditFile',
                message,
              })
            ),
        })
      )

      // Phase 4: Apply edits bottom-to-top so earlier indices stay valid.
      const lines = [...originalLines]
      for (const edit of [...resolved].reverse()) {
        switch (edit.type) {
          case 'replace': {
            const newLines = edit.content.split('\n')
            lines.splice(
              edit.startIdx,
              edit.endIdx - edit.startIdx + 1,
              ...newLines
            )
            break
          }
          case 'insert': {
            const newLines = edit.content.split('\n')
            // afterIdx -1 means beginning of file → splice at 0
            lines.splice(edit.afterIdx + 1, 0, ...newLines)
            break
          }
          case 'delete': {
            lines.splice(edit.startIdx, edit.endIdx - edit.startIdx + 1)
            break
          }
        }
      }

      const newContent = lines.join('\n')
      yield* files.writeFile(path, newContent)

      yield* Effect.logInfo('EditFile tool applied edits', {
        path,
        editCount: edits.length,
        originalLines: originalLines.length,
        newLines: lines.length,
      })

      return `Successfully applied ${edits.length} edit(s) to ${path}`
    }).pipe(
      Effect.annotateLogs({ package: 'core', subsystem: 'tool', tool: 'EditFile' }),
      Effect.withLogSpan('tool.EditFile')
    ),
}
