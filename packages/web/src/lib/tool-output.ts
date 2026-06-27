import {
  getFiletypeFromFileName,
  getHighlighterOptions,
  parseDiffFromFile,
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

export function parseToolDiff(
  display: Extract<ToolResultDisplay, { type: 'diff' }>
): FileDiffMetadata {
  return parseDiffFromFile(display.oldFile, display.newFile)
}

export function diffStats(fileDiff: FileDiffMetadata): DiffStats {
  return fileDiff.hunks.reduce(
    (stats, hunk) => ({
      additions: stats.additions + hunk.additionLines,
      deletions: stats.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 }
  )
}

export function diffDisplaySummary(
  display: ToolResultDisplay | undefined
): DiffDisplaySummary | undefined {
  if (!display) return undefined

  switch (display.type) {
    case 'diff': {
      return {
        fileName: display.newFile.name,
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
      part.type === 'tool-result' && part.bodyDisplay?.type === 'diff'
        ? [part.bodyDisplay]
        : []
    )
  )

  await Promise.allSettled(displays.map(preloadToolDiffDisplay))
}

async function preloadToolDiffDisplay(
  display: Extract<ToolResultDisplay, { type: 'diff' }>
) {
  const fileDiff = parseToolDiff(display)
  await preloadHighlighter(
    getHighlighterOptions(
      fileDiff.lang ?? getFiletypeFromFileName(fileDiff.name),
      {
        theme: toolDiffTheme,
      }
    )
  )
}
