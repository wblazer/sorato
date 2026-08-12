export interface SummarySection {
  readonly text: string
  readonly complete: boolean
}

interface ParsedJsonString {
  readonly text: string
  readonly end: number
  readonly complete: boolean
}

const decodeEscape = (character: string): string => {
  switch (character) {
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    default:
      return character
  }
}

const parseJsonString = (source: string, start: number): ParsedJsonString => {
  let text = ''
  let index = start

  while (index < source.length) {
    const character = source[index]
    if (character === '"') {
      return { text, end: index + 1, complete: true }
    }
    if (character !== '\\') {
      text += character
      index += 1
      continue
    }

    const escaped = source[index + 1]
    if (escaped === undefined) break
    if (escaped !== 'u') {
      text += decodeEscape(escaped)
      index += 2
      continue
    }

    const code = source.slice(index + 2, index + 6)
    if (code.length < 4 || !/^[0-9a-f]{4}$/i.test(code)) break
    text += String.fromCharCode(Number.parseInt(code, 16))
    index += 6
  }

  return { text, end: source.length, complete: false }
}

/**
 * Projects the known multi-summary JSON envelope into user-facing prose while
 * it is still incomplete. Raw JSON syntax is intentionally never returned.
 */
export const streamedSummarySections = (
  source: string
): ReadonlyArray<SummarySection> => {
  const summariesIndex = source.indexOf('"summaries"')
  if (summariesIndex < 0 || source.lastIndexOf('{', summariesIndex) < 0)
    return []

  const sections: SummarySection[] = []
  let cursor = summariesIndex + '"summaries"'.length

  while (cursor < source.length) {
    const keyIndex = source.indexOf('"content"', cursor)
    if (keyIndex < 0) break
    const colonIndex = source.indexOf(':', keyIndex + '"content"'.length)
    if (colonIndex < 0) break
    let valueIndex = colonIndex + 1
    while (/\s/.test(source[valueIndex] ?? '')) valueIndex += 1
    if (source[valueIndex] !== '"') {
      cursor = valueIndex
      continue
    }

    const parsed = parseJsonString(source, valueIndex + 1)
    if (parsed.text.length > 0) {
      sections.push({ text: parsed.text, complete: parsed.complete })
    }
    if (!parsed.complete) break
    cursor = parsed.end
  }

  return sections
}
