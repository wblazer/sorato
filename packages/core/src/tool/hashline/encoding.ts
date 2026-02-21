/**
 * Hashline encoding — content-addressed line anchors for safe file editing.
 *
 * Each line gets a 2-char hex hash derived from its content. When the model
 * reads a file it sees `<line>:<hash>|<content>`, and when it edits it
 * references lines by their `<line>:<hash>` anchor. If the file changed
 * since the last read, the hashes won't match and the edit is rejected
 * before anything gets corrupted.
 *
 * Hashes are deterministic — purely derived from line content, no mutable
 * state. The "state" is the file itself.
 *
 * Fixed 2-char hex hashes (256 values). The line number is the primary key;
 * the hash is a lightweight integrity check. Collisions are possible but
 * require three compounding unlikely events (file changed + target line
 * changed + hash collision). oh-my-pi ships the same approach.
 */

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Hash length — fixed at 2 hex chars. */
export const HASH_LENGTH = 2

/**
 * FNV-1a 32-bit hash. Fast, well-distributed, no crypto needed.
 */
const fnv1a32 = (input: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) | 0
  }
  return hash >>> 0
}

/** 2-char hex hash of a line's content. */
export const hashLine = (content: string): string =>
  fnv1a32(content).toString(16).padStart(8, '0').slice(0, HASH_LENGTH)

// ---------------------------------------------------------------------------
// Encoding (file content → hashline-annotated string)
// ---------------------------------------------------------------------------

/** Options for controlling which lines to encode and how to truncate. */
export interface EncodeOptions {
  /** 1-indexed line to start from. Defaults to 1. */
  readonly offset?: number | undefined
  /** Maximum number of lines to return. Defaults to all remaining lines. */
  readonly limit?: number | undefined
  /** Maximum characters per line before truncation. No limit if unset. */
  readonly maxLineLength?: number | undefined
  /** Maximum total bytes of output before truncation. No limit if unset. */
  readonly maxBytes?: number | undefined
}

export interface EncodeResult {
  /** The formatted hashline string. */
  readonly text: string
  /** Total lines in the file. */
  readonly totalLines: number
  /** 1-indexed line number of the last line included in the output. */
  readonly lastLine: number
  /** Whether the output was truncated by the byte cap. */
  readonly truncatedByBytes: boolean
}

/**
 * Encode file content into hashline format.
 *
 * Output (one per line):
 *   `<lineNumber>:<hash>|<content>`
 *
 * Line numbers are 1-indexed. Example:
 *   1:a3|function hello() {
 *   2:f1|  return "world";
 *   3:0e|}
 */
export const encode = (
  content: string,
  options?: EncodeOptions
): EncodeResult => {
  const allLines = content.split('\n')

  const offset = Math.max(1, options?.offset ?? 1)
  const startIdx = offset - 1
  const limit = options?.limit ?? allLines.length
  const endIdx = Math.min(startIdx + limit, allLines.length)
  const maxLineLen = options?.maxLineLength
  const maxBytes = options?.maxBytes

  const encoder = new TextEncoder()
  const annotated: Array<string> = []
  let byteCount = 0
  let truncatedByBytes = false
  // Start before the first possible line so the footer is correct when
  // zero lines are emitted (e.g. limit=0 or byte cap too small).
  let lastLine = offset - 1

  for (let i = startIdx; i < endIdx; i++) {
    const lineNum = i + 1
    const raw = allLines[i]!
    const displayLine =
      maxLineLen !== undefined && raw.length > maxLineLen
        ? raw.slice(0, maxLineLen) + '...'
        : raw
    const hash = hashLine(raw)
    const formatted = `${lineNum}:${hash}|${displayLine}`

    // Real UTF-8 byte length, +1 for the newline between lines
    const lineBytes =
      encoder.encode(formatted).byteLength + (annotated.length > 0 ? 1 : 0)
    if (maxBytes !== undefined && byteCount + lineBytes > maxBytes) {
      truncatedByBytes = true
      break
    }

    annotated.push(formatted)
    byteCount += lineBytes
    lastLine = lineNum
  }

  return {
    text: annotated.join('\n'),
    totalLines: allLines.length,
    lastLine,
    truncatedByBytes,
  }
}

// ---------------------------------------------------------------------------
// Anchor parsing + resolution
// ---------------------------------------------------------------------------

/** A parsed `<line>:<hash>` anchor. */
export interface Anchor {
  readonly line: number
  readonly hash: string
}

/** Parse "3:0e" into its components. Returns null on malformed input. */
export const parseAnchor = (anchor: string): Anchor | null => {
  const colonIdx = anchor.indexOf(':')
  if (colonIdx === -1) return null

  const line = parseInt(anchor.slice(0, colonIdx), 10)
  const hash = anchor.slice(colonIdx + 1)

  if (isNaN(line) || line < 1 || hash.length === 0) return null
  return { line, hash }
}

/**
 * Resolve an anchor against actual file lines. Returns the 0-based index
 * on match, or a structured mismatch with context for the error message.
 *
 * Line number is the primary key; hash is the integrity check.
 */
export const resolveAnchor = (
  anchor: Anchor,
  lines: ReadonlyArray<string>
): { readonly index: number } | { readonly error: string } => {
  const idx = anchor.line - 1

  const line = lines[idx]
  if (idx < 0 || idx >= lines.length || line === undefined) {
    return {
      error: `Line ${anchor.line} is out of range (file has ${lines.length} lines)`,
    }
  }

  const expectedHash = hashLine(line)

  if (anchor.hash !== expectedHash) {
    // Show the model what the correct anchor is so it can self-correct
    // or decide to re-read.
    return {
      error: `Hash mismatch at line ${anchor.line}: you provided "${anchor.line}:${anchor.hash}" but the current content has hash "${expectedHash}". Current line content: "${line.length > 120 ? line.slice(0, 120) + '...' : line}". Re-read the file to get fresh anchors.`,
    }
  }

  return { index: idx }
}
