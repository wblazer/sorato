import { describe, expect, it } from 'vitest'
import type { MessageNode, ServerEvent, Session } from '$lib/types.js'
import { patchSessionFromNodeBatch } from './session-events.js'

const session: Session = {
  id: 'session-1',
  projectId: 'project-1',
  title: null,
  status: 'running',
  archivedAt: null,
  lastUserMessageAt: 2,
  createdAt: 1,
  updatedAt: 2,
}

const userNode = (id: string, createdAt: number): MessageNode => ({
  id,
  sessionId: session.id,
  parentId: null,
  kind: 'message',
  messageId: id,
  summaryId: null,
  sourceNodeId: null,
  runId: 'run-1',
  run: null,
  modelCall: null,
  encoded: { role: 'user', content: id },
  createdAt,
})

describe('session node batch metadata', () => {
  it('patches updatedAt and the latest committed user timestamp', () => {
    const event: Extract<ServerEvent, { readonly _tag: 'NodeBatchCommitted' }> =
      {
        _tag: 'NodeBatchCommitted',
        sequence: 3,
        sessionId: session.id,
        sessionUpdatedAt: 20,
        runId: 'run-1',
        nodes: [userNode('earlier', 10), userNode('later', 15)],
        headNodeId: 'later',
      }

    expect(patchSessionFromNodeBatch(session, event)).toMatchObject({
      updatedAt: 20,
      lastUserMessageAt: 15,
    })
  })
})
