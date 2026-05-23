import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'
import type { ToolResultDisplay } from '$lib/types.js'

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
