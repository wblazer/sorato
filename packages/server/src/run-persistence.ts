import { Prompt } from 'effect/unstable/ai'
import { Effect, Schema } from 'effect'
import type { HarnessEvent, HarnessHook, HarnessResult } from '@sorato/core'
import {
  SessionStorage,
  StorageError,
  type BillingMode,
  type SessionId,
} from './session/session.ts'
import { StoredMessage, type StoredMessageEncoded } from '@sorato/core/message'
import { EventBus } from './event-bus.ts'
import { pricedUsage, type CostInfo } from './run-cost.ts'

const INTERRUPTED_TOOL_RESULT = 'Tool execution interrupted.'

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
      ...(headerPresentation?.header !== undefined
        ? { header: headerPresentation.header }
        : {}),
      ...(bodyPresentation?.bodyDisplay !== undefined
        ? { bodyDisplay: bodyPresentation.bodyDisplay }
        : {}),
      ...(part.isFailure && part.result === INTERRUPTED_TOOL_RESULT
        ? { metadata: { interrupted: true } }
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

const markLastAssistantInterrupted = (
  messages: ReadonlyArray<StoredMessageEncoded>
): ReadonlyArray<StoredMessageEncoded> => {
  const index = messages.findLastIndex(
    (message) => message.role === 'assistant'
  )
  if (index === -1) return messages

  return messages.map((message, messageIndex) =>
    messageIndex === index && message.role === 'assistant'
      ? {
          ...message,
          metadata: { ...message.metadata, interrupted: true },
        }
      : message
  )
}

export const createPersistenceHook = Effect.fn(
  'RunPersistence.createPersistenceHook'
)(function* (
  sessionId: SessionId,
  runId: string,
  messageCountBeforeRun: number,
  appendBaseNodeId: string | null,
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
  let nextAppendBaseNodeId = appendBaseNodeId
  const persistResult = Effect.fn('RunPersistence.persistResult')(function* (
    result: HarnessResult,
    interrupted: boolean
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
    const newMessages = interrupted
      ? markLastAssistantInterrupted(displayMessages)
      : displayMessages

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

    const nodeIds = yield* storage.append(
      sessionId,
      runId,
      newMessages,
      nextAppendBaseNodeId
    )
    nextAppendBaseNodeId = nodeIds.at(-1) ?? nextAppendBaseNodeId
    nextMessageIndex += encodedNewMessages.length

    const assistantNodeIds = newMessages.flatMap((message, index) => {
      const nodeId = nodeIds[index]
      return message.role === 'assistant' && nodeId !== undefined
        ? [nodeId]
        : []
    })
    yield* Effect.forEach(
      assistantNodeIds,
      (assistantNodeId, index) => {
        const modelCallUsage = modelCallUsages[index]
        const usage = modelCallUsage?.usage ?? nullUsage
        const timing =
          modelCallUsage ??
          (interrupted && index === assistantNodeIds.length - 1
            ? result.incompleteModelCall
            : undefined)
        return storage.createModelCall({
          sessionId,
          runId,
          assistantNodeId,
          providerId: pricing.providerId,
          modelId: pricing.modelId,
          billingMode: pricing.billingMode,
          startedAt: timing?.startedAt ?? null,
          finishedAt: timing?.finishedAt ?? Date.now(),
          ...usage,
        })
      },
      { discard: true }
    )
    nextModelCallIndex += Math.min(
      assistantNodeIds.length,
      modelCallUsages.length
    )

    yield* bus.publish({ _tag: 'MessagesAppended', sessionId, runId })
    yield* bus.publish({ _tag: 'SessionUpdated', sessionId })
  })

  return {
    name: 'persist',
    handle: (event: HarnessEvent) =>
      Effect.gen(function* () {
        if (event._tag === 'ModelCallComplete') {
          yield* persistResult(event.result, false)
          return
        }

        if (event._tag === 'RunResult') {
          yield* persistResult(event.result, event.interrupted)
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
