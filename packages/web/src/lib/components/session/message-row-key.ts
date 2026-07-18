import type { MessageNode } from '$lib/types.js'

export const runSegmentKey = (runId: string, segmentIndex: number): string =>
  `run:${runId}:segment:${segmentIndex}`

export const assistantToolGroupKey = (
  firstMessage: MessageNode,
  segmentIndex: number
): string =>
  firstMessage.runId === null
    ? firstMessage.id
    : runSegmentKey(firstMessage.runId, segmentIndex)
