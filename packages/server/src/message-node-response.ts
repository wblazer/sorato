import {
  MessageNodeResponse,
  RunSummaryResponse,
  RunUsageResponse,
  type ServerEvent,
} from '@sorato/api'
import type { CommittedNodeBatch, MessageNode } from './session/session.ts'

export const toMessageNodeResponse = (node: MessageNode) =>
  MessageNodeResponse.make({
    id: node.id,
    sessionId: node.sessionId,
    parentId: node.parentId,
    kind: node.kind,
    messageId: node.messageId,
    summaryId: node.summaryId,
    sourceNodeId: node.sourceNodeId,
    runId: node.runId,
    run:
      node.run === null
        ? null
        : RunSummaryResponse.make({
            id: node.run.id,
            status: node.run.status,
            providerId: node.run.providerId,
            modelId: node.run.modelId,
            billingMode: node.run.billingMode,
            usage: RunUsageResponse.make({
              inputTokens: node.run.inputTokens,
              outputTokens: node.run.outputTokens,
              reasoningTokens: node.run.reasoningTokens,
              cacheReadTokens: node.run.cacheReadTokens,
              cacheWriteTokens: node.run.cacheWriteTokens,
              totalTokens: node.run.totalTokens,
              contextWindowTokens: node.run.contextWindowTokens,
              actualCostMicrosUsd: node.run.actualCostMicrosUsd,
              listPriceMicrosUsd: node.run.listPriceMicrosUsd,
            }),
            createdAt: node.run.createdAt,
            completedAt: node.run.completedAt,
          }),
    modelCall: node.modelCall,
    encoded: node.encoded,
    createdAt: node.createdAt,
  })

export const toNodeBatchCommitted = (
  batch: CommittedNodeBatch
): Extract<ServerEvent, { readonly _tag: 'NodeBatchCommitted' }> => ({
  _tag: 'NodeBatchCommitted',
  sequence: batch.sequence,
  sessionId: batch.sessionId,
  runId: batch.runId,
  nodes: batch.nodes.map(toMessageNodeResponse),
  headNodeId: batch.headNodeId,
  sessionUpdatedAt: batch.sessionUpdatedAt,
  ...(batch.contentThroughEventId === undefined
    ? {}
    : { contentThroughEventId: batch.contentThroughEventId }),
})
