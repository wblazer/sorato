import { Prompt } from 'effect/unstable/ai'
import { Effect, Ref, Schema } from 'effect'
import type { HarnessEvent, HarnessHook, HarnessResult } from '@sorato/core'
import { stringifyToolResult } from '@sorato/core/presentation'
import {
  SessionStorage,
  StorageError,
  type BillingMode,
  type SessionId,
} from './session/session.ts'
import { StoredMessage, type StoredMessageEncoded } from '@sorato/core/message'
import { EventBus } from './event-bus.ts'
import { pricedUsage, type CostInfo } from './run-cost.ts'
import { getContentThroughEventId } from './event-replay.ts'
import { toNodeBatchCommitted } from './message-node-response.ts'

const nullUsage = {
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  contextWindowTokens: null,
  actualCostMicrosUsd: null,
  listPriceMicrosUsd: null,
}

const addToolDisplays = (
  messages: ReadonlyArray<Prompt.MessageEncoded>,
  callHeaders: HarnessResult['toolCallHeaders'],
  resultHeaders: HarnessResult['toolResultHeaders'],
  resultBodyDisplays: HarnessResult['toolResultBodyDisplays']
): ReadonlyArray<StoredMessageEncoded> => {
  const addDisplayToCallPart = (
    part: Prompt.ToolCallPartEncoded
  ): Prompt.ToolCallPartEncoded => {
    const presentation = callHeaders.get(part.id)
    if (!presentation) return part

    return {
      ...part,
      ...(presentation.header !== undefined
        ? { header: presentation.header }
        : {}),
    }
  }

  const addDisplayToPart = (
    part: Prompt.ToolResultPartEncoded
  ): Prompt.ToolResultPartEncoded => {
    const headerPresentation = resultHeaders.get(part.id)
    const bodyPresentation = resultBodyDisplays.get(part.id)

    return {
      ...part,
      result: stringifyToolResult(part.result),
      ...(headerPresentation?.header !== undefined
        ? { header: headerPresentation.header }
        : {}),
      ...(bodyPresentation?.bodyDisplay !== undefined
        ? { bodyDisplay: bodyPresentation.bodyDisplay }
        : {}),
    }
  }

  return messages.map((message) => {
    const withDisplay = (() => {
      switch (message.role) {
        case 'assistant':
          if (typeof message.content === 'string') return message
          return {
            ...message,
            content: message.content.map((part) => {
              if (part.type === 'tool-call') return addDisplayToCallPart(part)
              if (part.type === 'tool-result') return addDisplayToPart(part)
              return part
            }),
          }
        case 'tool':
          return {
            ...message,
            content: message.content.map((part) =>
              part.type === 'tool-result' ? addDisplayToPart(part) : part
            ),
          }
        case 'system':
        case 'user':
          return message
      }
    })()

    return Schema.decodeUnknownSync(StoredMessage)(withDisplay)
  })
}

export const createPersistenceHook = Effect.fn(
  'RunPersistence.createPersistenceHook'
)(function* (
  sessionId: SessionId,
  runId: string,
  messageCountBeforeRun: number,
  appendBaseNodeId: Ref.Ref<string | null>,
  pricing: {
    readonly providerId: string
    readonly modelId: string
    readonly billingMode: BillingMode
    readonly cost: CostInfo | undefined
  }
) {
  const bus = yield* EventBus
  let nextMessageIndex = messageCountBeforeRun
  let nextModelCallIndex = 0
  const persistResult = Effect.fn('RunPersistence.persistResult')(function* (
    result: HarnessResult,
    interrupted: boolean,
    contentThroughEventId: number | undefined
  ) {
    const storage = yield* SessionStorage
    const encoded = yield* Effect.try({
      try: () => Schema.encodeSync(Prompt.Prompt)(result.conversation),
      catch: (error) =>
        new StorageError({
          operation: 'run',
          message: `Failed to encode conversation: ${String(error)}`,
        }),
    })

    const encodedNewMessages = encoded.content.slice(nextMessageIndex)
    const displayMessages = addToolDisplays(
      encodedNewMessages,
      result.toolCallHeaders,
      result.toolResultHeaders,
      result.toolResultBodyDisplays
    )
    const newMessages = displayMessages

    if (newMessages.length === 0) return

    const modelCallUsages = result.modelCalls
      .slice(nextModelCallIndex)
      .map((modelCall) => ({
        usage: pricedUsage(
          modelCall.usage,
          pricing.billingMode,
          pricing.cost,
          modelCall.contextTokens
        ),
        startedAt: modelCall.startedAt,
        finishedAt: modelCall.finishedAt,
      }))

    yield* Effect.logInfo('Persisting run messages', {
      sessionId,
      runId,
      messageCount: newMessages.length,
      interrupted,
    })

    const assistantCount = newMessages.filter(
      (message) => message.role === 'assistant'
    ).length
    let assistantIndex = 0
    const modelCalls = newMessages.flatMap((message, messageIndex) => {
      if (message.role !== 'assistant') return []
      const index = assistantIndex++
      const modelCallUsage = modelCallUsages[index]
      const usage = modelCallUsage?.usage ?? nullUsage
      const timing =
        modelCallUsage ??
        (interrupted && index === assistantCount - 1
          ? result.incompleteModelCall
          : undefined)
      return [
        {
          messageIndex,
          providerId: pricing.providerId,
          modelId: pricing.modelId,
          billingMode: pricing.billingMode,
          startedAt: timing?.startedAt ?? null,
          finishedAt: timing?.finishedAt ?? Date.now(),
          ...usage,
        },
      ]
    })

    const currentAppendBaseNodeId = yield* Ref.get(appendBaseNodeId)
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const batch = yield* storage.commitNodeBatch({
          sessionId,
          runId,
          messages: newMessages,
          baseNodeId: currentAppendBaseNodeId,
          modelCalls,
          ...(contentThroughEventId === undefined
            ? {}
            : { contentThroughEventId }),
        })
        if (batch === null) return
        yield* Ref.set(appendBaseNodeId, batch.headNodeId)
        yield* Effect.sync(() => {
          nextMessageIndex += encodedNewMessages.length
          nextModelCallIndex += Math.min(assistantIndex, modelCallUsages.length)
        })
        yield* bus.publish(toNodeBatchCommitted(batch))
      })
    )
  })

  return {
    name: 'persist',
    handle: (event: HarnessEvent) =>
      Effect.gen(function* () {
        if (event._tag === 'ModelCallComplete') {
          yield* persistResult(
            event.result,
            false,
            getContentThroughEventId(runId)
          )
          return
        }

        if (event._tag === 'RunResult') {
          yield* persistResult(
            event.result,
            event.interrupted,
            getContentThroughEventId(runId)
          )
        }
      }).pipe(
        Effect.annotateLogs({
          package: 'server',
          subsystem: 'run-persistence',
          sessionId,
        }),
        Effect.withLogSpan('server.persistRun')
      ),
  } satisfies HarnessHook<StorageError, SessionStorage>
})
