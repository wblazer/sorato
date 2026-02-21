/**
 * Hashline encoding — content-addressed line anchors for safe file editing.
 *
 * Each line gets a short hex hash derived from its content. When the model
 * reads a file it sees `<line>:<hash>|<content>`, and when it edits it
 * references lines by their `<line>:<hash>` anchor. If the file changed
 * since the last read, the hashes won't match and the edit is rejected
 * before anything gets corrupted.
 *
 * Hashes are deterministic — purely derived from line content, no mutable
 * state. The "state" is the file itself.
 *
 * Uses 2 hex chars by default, expanding to 3 or 4 only when collisions
 * exist within a file. Line numbers still disambiguate regardless, but
 * fewer collisions means more distinctive anchors for the model.
 */

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

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

/** Hex hash of a line's content, truncated to `length` characters. */
export const hashLine = (content: string, length: number): string =>
  fnv1a32(content).toString(16).padStart(8, '0').slice(0, length)

/**
 * Pick the shortest hash length (2–4 hex chars) that avoids collisions
 * within the given set of lines. Collisions aren't fatal — line numbers
 * disambiguate — but fewer collisions means more distinctive anchors.
 */
export const pickHashLength = (lines: ReadonlyArray<string>): number => {
  for (const len of [2, 3, 4] as const) {
    const seen = new Set<string>()
    let collision = false
    for (const line of lines) {
      const h = hashLine(line, len)
      if (seen.has(h)) {
        collision = true
        break
      }
      seen.add(h)
    }
    if (!collision) return len
  }
  return 4
}

// ---------------------------------------------------------------------------
// Encoding (file content → hashline-annotated string)
// ---------------------------------------------------------------------------

/** Options for controlling which lines to encode and how to truncate. */
export interface EncodeOptions {
  /**
   * 1-indexed line to start from. Defaults to 1.
   * Hash length is still computed against the full file so anchors are
   * stable across reads with different offsets.
   */
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
  /** Hash length used (2, 3, or 4). */
  readonly hashLength: number
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
  // Hash length computed against the FULL file — anchors must be stable
  // regardless of which slice the caller requested.
  const hashLength = pickHashLength(allLines)

  const offset = Math.max(1, options?.offset ?? 1)
  const startIdx = offset - 1
  const limit = options?.limit ?? allLines.length
  const endIdx = Math.min(startIdx + limit, allLines.length)
  const maxLineLen = options?.maxLineLength
  const maxBytes = options?.maxBytes

  const annotated: Array<string> = []
  let byteCount = 0
  let truncatedByBytes = false
  let lastLine = offset

  for (let i = startIdx; i < endIdx; i++) {
    const lineNum = i + 1
    const raw = allLines[i]!
    const displayLine =
      maxLineLen !== undefined && raw.length > maxLineLen
        ? raw.slice(0, maxLineLen) + '...'
        : raw
    const hash = hashLine(allLines[i]!, hashLength)
    const formatted = `${lineNum}:${hash}|${displayLine}`

    // +1 for the newline between lines
    const lineBytes = formatted.length + (annotated.length > 0 ? 1 : 0)
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
    hashLength,
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
 * on match, or an error message on mismatch.
 *
 * Line number is the primary key; hash is the integrity check.
 */
export const resolveAnchor = (
  anchor: Anchor,
  lines: ReadonlyArray<string>,
  hashLength: number
): { readonly index: number } | { readonly error: string } => {
  const idx = anchor.line - 1

  const line = lines[idx]
  if (idx < 0 || idx >= lines.length || line === undefined) {
    return {
      error: `Line ${anchor.line} is out of range (file has ${lines.length} lines)`,
    }
  }

  const expectedHash = hashLine(line, hashLength)

  if (anchor.hash !== expectedHash) {
    return {
      error: `Hash mismatch at line ${anchor.line}: expected "${expectedHash}", got "${anchor.hash}". The file may have changed since you last read it — re-read to get fresh anchors.`,
    }
  }

  return { index: idx }
}
