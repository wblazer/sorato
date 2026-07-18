import type { ServerEvent } from '$lib/types.js'
import { isDurableServerEvent } from '@sorato/api'

export const durableEventSequence = (event: ServerEvent): number | null =>
  isDurableServerEvent(event) ? event.sequence : null

export interface DurableEventAcceptance {
  readonly accepted: boolean
  readonly lastSequence: number
}

export const acceptDurableEvent = (
  lastSequence: number,
  event: ServerEvent
): DurableEventAcceptance => {
  const sequence = durableEventSequence(event)
  if (sequence === null) return { accepted: true, lastSequence }
  if (sequence <= lastSequence) return { accepted: false, lastSequence }
  return { accepted: true, lastSequence: sequence }
}
