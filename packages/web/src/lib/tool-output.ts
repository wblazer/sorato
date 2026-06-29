import {
  getFiletypeFromFileName,
  getHighlighterOptions,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
  type FileDiffMetadata,
} from '@pierre/diffs'
import type { MessageNode, ToolResultDisplay } from '$lib/types.js'
import { messageParts } from '$lib/transcript.js'

export const toolDiffTheme = {
  dark: 'pierre-dark' as const,
  light: 'pierre-light' as const,
}

export interface DiffStats {
  additions: number
  deletions: number
}

export interface DiffDisplaySummary extends DiffStats {
  fileName: string
}

const parsedDiffs = new Map<string, FileDiffMetadata>()
const highlighterPreloads = new Map<string, Promise<void>>()

export function parseToolDiff(
  display: ToolResultDisplay,
  cacheKey?: string | undefined
): FileDiffMetadata {
  if (cacheKey !== undefined) {
    const cached = parsedDiffs.get(cacheKey)
    if (cached !== undefined) return cached
  }

  const parsed =
    parsePatchFiles(patchInput(display.fileName, display.patch))[0]?.files[0] ??
    parseDiffFromFile(
      { name: display.fileName, contents: '' },
      { name: display.fileName, contents: '' }
    )
  if (cacheKey !== undefined) parsedDiffs.set(cacheKey, parsed)
  return parsed
}

const patchInput = (fileName: string, patch: string) =>
  `Index: ${fileName}\n===================================================================\n${patch}`

export function diffDisplaySummary(
  display: ToolResultDisplay | undefined
): DiffDisplaySummary | undefined {
  if (!display) return undefined

  switch (display.type) {
    case 'inline-diff': {
      return {
        fileName: display.fileName,
        ...display.summary,
      }
    }
  }
}

export async function preloadMessageToolDiffs(
  messages: ReadonlyArray<MessageNode>
) {
  const displays = messages.flatMap((message) =>
    messageParts(message).flatMap((part) =>
      part.type === 'tool-result' && part.bodyDisplay?.type === 'inline-diff'
        ? [{ display: part.bodyDisplay, cacheKey: part.id }]
        : []
    )
  )

  await Promise.allSettled(
    displays.map(({ display, cacheKey }) => preloadToolDiff(display, cacheKey))
  )
}

export async function preloadToolDiff(
  display: ToolResultDisplay,
  cacheKey: string
) {
  const existing = highlighterPreloads.get(cacheKey)
  if (existing !== undefined) return existing

  const preload = (async () => {
    const fileDiff = parseToolDiff(display, cacheKey)
    await preloadHighlighter(
      getHighlighterOptions(
        fileDiff.lang ?? getFiletypeFromFileName(fileDiff.name),
        { theme: toolDiffTheme }
      )
    )
  })()
  highlighterPreloads.set(cacheKey, preload)
  return preload
}
