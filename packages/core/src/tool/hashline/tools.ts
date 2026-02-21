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
import { Tool } from '@effect/ai'
import { Effect, Schema } from 'effect'
import { CurrentSandbox, SandboxError } from '../../sandbox/sandbox.ts'
import {
  encode,
  parseAnchor,
  pickHashLength,
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
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++
    }
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.3
}

/** Extract the file extension (lowercase, with dot) from a path. */
const extOf = (path: string): string => {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

// ---------------------------------------------------------------------------
// ReadFile — tool declaration
// ---------------------------------------------------------------------------

export const ReadFile = Tool.make('ReadFile', {
  description:
    'Read a file. Returns lines annotated with content-hash anchors in the format `<line>:<hash>|<content>`. Use these `<line>:<hash>` anchors when calling EditFile. Supports reading specific line ranges via offset/limit.',
  parameters: {
    path: Schema.String.annotations({
      description: 'Absolute or relative path to the file',
    }),
    offset: Schema.optional(Schema.Number).annotations({
      description:
        '1-indexed line number to start reading from. Defaults to 1.',
    }),
    limit: Schema.optional(Schema.Number).annotations({
      description: `Maximum number of lines to return. Defaults to ${DEFAULT_LIMIT}.`,
    }),
  },
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentSandbox],
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
      const sandbox = yield* CurrentSandbox

      // Binary extension check — fast reject before reading content
      if (BINARY_EXTENSIONS.has(extOf(path))) {
        return yield* new SandboxError({
          operation: 'ReadFile',
          message: `Cannot read binary file: ${path}`,
        })
      }

      const content = yield* sandbox.readFile(path)

      // Binary content check — catch files without known extensions
      if (isBinaryContent(content)) {
        return yield* new SandboxError({
          operation: 'ReadFile',
          message: `Cannot read binary file: ${path}`,
        })
      }

      const effectiveOffset = offset ?? 1
      if (effectiveOffset < 1) {
        return yield* new SandboxError({
          operation: 'ReadFile',
          message: 'offset must be greater than or equal to 1',
        })
      }

      const result = encode(content, {
        offset: effectiveOffset,
        limit: limit ?? DEFAULT_LIMIT,
        maxLineLength: MAX_LINE_LENGTH,
        maxBytes: MAX_BYTES,
      })

      if (effectiveOffset > result.totalLines) {
        return yield* new SandboxError({
          operation: 'ReadFile',
          message: `Offset ${effectiveOffset} is out of range (file has ${result.totalLines} lines)`,
        })
      }

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
    }),
} as const

// ---------------------------------------------------------------------------
// EditFile — schema types
// ---------------------------------------------------------------------------

const AnchorSchema = Schema.String.annotations({
  description:
    'A line anchor in the format "<line>:<hash>" from the last ReadFile output, e.g. "3:0e"',
})

const ContentSchema = Schema.String.annotations({
  description: 'The new content to insert (may contain newlines)',
})

const ReplaceOp = Schema.Struct({
  type: Schema.Literal('replace').annotations({
    description: 'Replace a range of lines (inclusive) with new content',
  }),
  startAnchor: AnchorSchema.annotations({
    description: 'Anchor of the first line to replace',
  }),
  endAnchor: AnchorSchema.annotations({
    description:
      'Anchor of the last line to replace (inclusive). Same as startAnchor for a single-line replace.',
  }),
  content: ContentSchema,
})

const InsertOp = Schema.Struct({
  type: Schema.Literal('insert').annotations({
    description: 'Insert new content after the referenced line',
  }),
  afterAnchor: AnchorSchema.annotations({
    description:
      'Anchor of the line after which to insert. Use "0" to insert at the beginning of the file.',
  }),
  content: ContentSchema,
})

const DeleteOp = Schema.Struct({
  type: Schema.Literal('delete').annotations({
    description: 'Delete a range of lines (inclusive)',
  }),
  startAnchor: AnchorSchema.annotations({
    description: 'Anchor of the first line to delete',
  }),
  endAnchor: AnchorSchema.annotations({
    description:
      'Anchor of the last line to delete (inclusive). Same as startAnchor for a single-line delete.',
  }),
})

const EditOp = Schema.Union(ReplaceOp, InsertOp, DeleteOp)

// ---------------------------------------------------------------------------
// EditFile — tool declaration
// ---------------------------------------------------------------------------

export const EditFile = Tool.make('EditFile', {
  description:
    'Edit a file using line anchors from the last ReadFile output. Each anchor is a `<line>:<hash>` pair that identifies a specific line. You must ReadFile before editing to obtain valid anchors. Edits must be in ascending line order and must not overlap.',
  parameters: {
    path: Schema.String.annotations({
      description: 'Path to the file (same path used in ReadFile)',
    }),
    edits: Schema.Array(EditOp).annotations({
      description:
        'Array of edit operations in ascending line order. Each operation references lines by their `<line>:<hash>` anchors from the last ReadFile call. Edits must not overlap — no two operations can touch the same lines.',
    }),
  },
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentSandbox],
})

// ---------------------------------------------------------------------------
// EditFile — handler internals
// ---------------------------------------------------------------------------

type EditOpType = typeof EditOp.Type

/** Parse an anchor string and resolve it against the original lines. */
const parseAndResolve = (
  anchorStr: string,
  lines: ReadonlyArray<string>,
  hashLength: number
): { readonly index: number } | { readonly error: string } => {
  const anchor = parseAnchor(anchorStr)
  if (!anchor) {
    return {
      error: `Invalid anchor format: "${anchorStr}". Expected "<line>:<hash>", e.g. "3:0e"`,
    }
  }
  return resolveAnchor(anchor, lines, hashLength)
}

/**
 * A resolved edit — anchors have been validated against the original
 * snapshot and converted to 0-based indices. These are what we actually
 * apply to the file.
 *
 * `sortKey` is the original-snapshot index used for ordering validation.
 * For inserts at the beginning of the file (afterAnchor "0"), it's -1
 * so it sorts before everything else.
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

/**
 * Resolve a raw edit op against the original lines. Returns a ResolvedEdit
 * with validated 0-based indices, or an error message.
 */
const resolveOp = (
  op: EditOpType,
  originalLines: ReadonlyArray<string>,
  hashLength: number
): ResolvedEdit | { readonly error: string } => {
  switch (op.type) {
    case 'replace': {
      const start = parseAndResolve(op.startAnchor, originalLines, hashLength)
      if ('error' in start) return start
      const end = parseAndResolve(op.endAnchor, originalLines, hashLength)
      if ('error' in end) return end
      if (start.index > end.index) {
        return {
          error: `startAnchor "${op.startAnchor}" is after endAnchor "${op.endAnchor}"`,
        }
      }
      return {
        type: 'replace',
        startIdx: start.index,
        endIdx: end.index,
        content: op.content,
        sortKey: start.index,
      }
    }
    case 'insert': {
      if (op.afterAnchor === '0') {
        return {
          type: 'insert',
          afterIdx: -1,
          content: op.content,
          sortKey: -1,
        }
      }
      const after = parseAndResolve(op.afterAnchor, originalLines, hashLength)
      if ('error' in after) return after
      return {
        type: 'insert',
        afterIdx: after.index,
        content: op.content,
        sortKey: after.index,
      }
    }
    case 'delete': {
      const start = parseAndResolve(op.startAnchor, originalLines, hashLength)
      if ('error' in start) return start
      const end = parseAndResolve(op.endAnchor, originalLines, hashLength)
      if ('error' in end) return end
      if (start.index > end.index) {
        return {
          error: `startAnchor "${op.startAnchor}" is after endAnchor "${op.endAnchor}"`,
        }
      }
      return {
        type: 'delete',
        startIdx: start.index,
        endIdx: end.index,
        sortKey: start.index,
      }
    }
  }
}

/**
 * Get the range of original-line indices that an edit touches.
 * Used for overlap detection.
 *
 * Returns [start, end] inclusive, or null for inserts (they don't
 * touch existing lines — they go between them).
 */
const touchedRange = (edit: ResolvedEdit): [number, number] | null => {
  switch (edit.type) {
    case 'replace':
      return [edit.startIdx, edit.endIdx]
    case 'delete':
      return [edit.startIdx, edit.endIdx]
    case 'insert':
      return null // inserts don't touch existing lines
  }
}

/**
 * Validate that resolved edits are in ascending order and don't overlap.
 * Returns an error message if validation fails.
 *
 * "Ascending order" means each edit's sortKey >= the previous one's.
 * "No overlap" means no two replace/delete ops touch the same original lines.
 */
const validateEditOrder = (
  edits: ReadonlyArray<ResolvedEdit>
): string | null => {
  for (let i = 1; i < edits.length; i++) {
    if (edits[i]!.sortKey < edits[i - 1]!.sortKey) {
      return `Edits must be in ascending line order. Edit ${i + 1} (line ${edits[i]!.sortKey + 1}) comes before edit ${i} (line ${edits[i - 1]!.sortKey + 1}).`
    }
  }

  // Check for overlapping ranges among replace/delete ops
  let lastEnd = -1
  for (let i = 0; i < edits.length; i++) {
    const range = touchedRange(edits[i]!)
    if (range === null) continue
    const [start, end] = range
    if (start <= lastEnd) {
      return `Edits overlap: edit ${i + 1} touches line ${start + 1}, which was already modified by a previous edit.`
    }
    lastEnd = end
  }

  return null
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
      const sandbox = yield* CurrentSandbox
      const content = yield* sandbox.readFile(path)
      const originalLines = content.split('\n')
      const hashLength = pickHashLength(originalLines)

      // Phase 1: Resolve all anchors against the original snapshot
      const resolved: Array<ResolvedEdit> = []
      for (const op of edits) {
        const result = resolveOp(op, originalLines, hashLength)
        if ('error' in result) {
          return yield* new SandboxError({
            operation: 'EditFile',
            message: result.error,
          })
        }
        resolved.push(result)
      }

      // Phase 2: Validate ordering and non-overlap
      const orderError = validateEditOrder(resolved)
      if (orderError) {
        return yield* new SandboxError({
          operation: 'EditFile',
          message: orderError,
        })
      }

      // Phase 3: Apply edits bottom-to-top so earlier indices stay valid.
      // We reverse the array since we validated it's in ascending order.
      const lines = [...originalLines]
      for (let i = resolved.length - 1; i >= 0; i--) {
        const edit = resolved[i]!
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
      yield* sandbox.writeFile(path, newContent)

      return `Successfully applied ${edits.length} edit(s) to ${path}`
    }),
} as const
