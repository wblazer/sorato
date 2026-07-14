import type { SelectedHead } from '$lib/selected-head-storage.js'
import type { ActiveRunSummary } from '$lib/types.js'

export function activeRunForHead(
  head: SelectedHead,
  activeRuns: ReadonlyArray<ActiveRunSummary>
): ActiveRunSummary | null {
  if (head?.type !== 'run') return null
  return activeRuns.find((run) => run.runId === head.runId) ?? null
}
