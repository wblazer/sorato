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
    'Edit a file using line anchors from the last ReadFile output. Each anchor is a `<line>:<hash>` pair that identifies a specific line. Edits in the array are applied sequentially — after all edits, the file is written. You must ReadFile before editing to obtain valid anchors.',
  parameters: {
    path: Schema.String.annotations({
      description: 'Path to the file (same path used in ReadFile)',
    }),
    edits: Schema.Array(EditOp).annotations({
      description:
        'Array of edit operations to apply sequentially. Each operation references lines by their `<line>:<hash>` anchors from the last ReadFile call.',
    }),
  },
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentSandbox],
})

// ---------------------------------------------------------------------------
// EditFile — handler
// ---------------------------------------------------------------------------

type EditOpType = typeof EditOp.Type

/**
 * Apply a single edit operation to a mutable lines array.
 * Returns an error message on failure, or void on success.
 *
 * After each operation, line numbers shift. The caller is responsible for
 * passing anchors that were valid at the time of the last read — we resolve
 * against the *current* state of `lines` which mutates as edits apply.
 *
 * Wait — that's the subtlety. Multiple edits in one call all reference
 * anchors from the same ReadFile snapshot. But as we apply edits, line
 * numbers shift. So we need to track an offset.
 *
 * Strategy: process edits top-to-bottom, maintaining a running line offset
 * that accounts for insertions and deletions above.
 */
const applyEdit = (
  lines: Array<string>,
  op: EditOpType,
  offset: number,
  hashLength: number,
  originalLines: ReadonlyArray<string>
): { readonly newOffset: number } | { readonly error: string } => {
  switch (op.type) {
    case 'replace': {
      const startResult = parseAndResolve(
        op.startAnchor,
        originalLines,
        hashLength
      )
      if ('error' in startResult) return startResult
      const endResult = parseAndResolve(op.endAnchor, originalLines, hashLength)
      if ('error' in endResult) return endResult

      if (startResult.index > endResult.index) {
        return {
          error: `startAnchor "${op.startAnchor}" is after endAnchor "${op.endAnchor}"`,
        }
      }

      const adjustedStart = startResult.index + offset
      const adjustedEnd = endResult.index + offset
      const newLines = op.content.split('\n')
      const deletedCount = adjustedEnd - adjustedStart + 1
      lines.splice(adjustedStart, deletedCount, ...newLines)

      return { newOffset: offset + (newLines.length - deletedCount) }
    }

    case 'insert': {
      // Special case: "0" means insert at the beginning of the file
      if (op.afterAnchor === '0') {
        const newLines = op.content.split('\n')
        lines.splice(0 + offset, 0, ...newLines)
        return { newOffset: offset + newLines.length }
      }

      const afterResult = parseAndResolve(
        op.afterAnchor,
        originalLines,
        hashLength
      )
      if ('error' in afterResult) return afterResult

      const adjustedAfter = afterResult.index + offset
      const newLines = op.content.split('\n')
      lines.splice(adjustedAfter + 1, 0, ...newLines)

      return { newOffset: offset + newLines.length }
    }

    case 'delete': {
      const startResult = parseAndResolve(
        op.startAnchor,
        originalLines,
        hashLength
      )
      if ('error' in startResult) return startResult
      const endResult = parseAndResolve(op.endAnchor, originalLines, hashLength)
      if ('error' in endResult) return endResult

      if (startResult.index > endResult.index) {
        return {
          error: `startAnchor "${op.startAnchor}" is after endAnchor "${op.endAnchor}"`,
        }
      }

      const adjustedStart = startResult.index + offset
      const adjustedEnd = endResult.index + offset
      const deletedCount = adjustedEnd - adjustedStart + 1
      lines.splice(adjustedStart, deletedCount)

      return { newOffset: offset - deletedCount }
    }
  }
}

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

      // Work on a mutable copy
      const lines = [...originalLines]
      let offset = 0

      for (const op of edits) {
        const result = applyEdit(lines, op, offset, hashLength, originalLines)
        if ('error' in result) {
          return yield* new SandboxError({
            operation: 'EditFile',
            message: result.error,
          })
        }
        offset = result.newOffset
      }

      const newContent = lines.join('\n')
      yield* sandbox.writeFile(path, newContent)

      return `Successfully applied ${edits.length} edit(s) to ${path}`
    }),
} as const
