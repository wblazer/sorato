import {
  getHighlighterOptions,
  getSharedHighlighter,
  type ThemedToken,
} from '@pierre/diffs'

const syntaxTheme = 'pierre-dark' as const

export async function highlightCode(
  source: string,
  language: string
): Promise<ReadonlyArray<ReadonlyArray<ThemedToken>> | undefined> {
  try {
    const highlighter = await getSharedHighlighter(
      getHighlighterOptions(language, { theme: syntaxTheme })
    )

    return highlighter.codeToTokens(source, {
      lang: language,
      theme: syntaxTheme,
    }).tokens
  } catch {
    return undefined
  }
}
