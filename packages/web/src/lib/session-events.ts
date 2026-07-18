import type { ServerEvent } from '$lib/types.js'
import type { Session } from '$lib/types.js'

type NodeBatchCommittedEvent = Extract<
  ServerEvent,
  { readonly _tag: 'NodeBatchCommitted' }
>

export const patchSessionFromNodeBatch = (
  session: Session,
  event: NodeBatchCommittedEvent
): Session => {
  if (session.id !== event.sessionId) return session
  const lastUserMessageAt = event.nodes.reduce<number | null>(
    (latest, node) =>
      node.encoded.role === 'user' &&
      (latest === null || node.createdAt > latest)
        ? node.createdAt
        : latest,
    null
  )
  return {
    ...session,
    updatedAt: event.sessionUpdatedAt,
    lastUserMessageAt: lastUserMessageAt ?? session.lastUserMessageAt,
  }
}
