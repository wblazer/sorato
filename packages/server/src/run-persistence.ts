import { Prompt } from 'effect/unstable/ai'
import { Effect, Schema } from 'effect'
import type { HarnessEvent, HarnessHook, HarnessResult } from '@sorato/core'
import {
  SessionStorage,
  StorageError,
  type BillingMode,
  type SessionId,
} from './session/session.ts'
import { publish } from './event-bus.ts'
import { pricedUsage, type CostInfo } from './run-cost.ts'

const stoppedSystemMessage = {
  role: 'system' as const,
  source: 'interruption' as const,
  display: { title: 'System', subtitle: 'Interruption' },
  content:
    '[The user stopped the previous response. The assistant message above may be incomplete.]',
}

const addToolDisplays = (
  messages: ReadonlyArray<Prompt.MessageEncoded>,
  callHeaders: HarnessResult['toolCallHeaders'],
  resultHeaders: HarnessResult['toolResultHeaders'],
  resultBodyDisplays: HarnessResult['toolResultBodyDisplays']
): ReadonlyArray<Prompt.MessageEncoded> => {
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
    }
  }

  return messages.map((message) => {
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
  })
}

export const createPersistenceHook = (
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
): HarnessHook<StorageError, SessionStorage> => {
  let nextMessageIndex = messageCountBeforeRun
  let nextModelCallIndex = 0
  let nextAppendBaseNodeId = appendBaseNodeId
  let interruptionMarkerPersisted = false

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
    const shouldAppendInterruptionMarker =
      interrupted && !interruptionMarkerPersisted
    const newMessages = shouldAppendInterruptionMarker
      ? [...displayMessages, stoppedSystemMessage]
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
    interruptionMarkerPersisted ||= shouldAppendInterruptionMarker

    const assistantNodeIds = displayMessages.flatMap((message, index) => {
      const nodeId = nodeIds[index]
      return message.role === 'assistant' && nodeId !== undefined
        ? [nodeId]
        : []
    })
    yield* Effect.forEach(
      assistantNodeIds,
      (assistantNodeId, index) => {
        const modelCallUsage = modelCallUsages[index]
        if (!modelCallUsage?.usage) return Effect.void
        return storage.createModelCall({
          sessionId,
          runId,
          assistantNodeId,
          providerId: pricing.providerId,
          modelId: pricing.modelId,
          billingMode: pricing.billingMode,
          startedAt: modelCallUsage.startedAt,
          finishedAt: modelCallUsage.finishedAt,
          ...modelCallUsage.usage,
        })
      },
      { discard: true }
    )
    nextModelCallIndex += Math.min(
      assistantNodeIds.length,
      modelCallUsages.length
    )

    publish({ _tag: 'MessagesAppended', sessionId, runId })
    publish({ _tag: 'SessionUpdated', sessionId })
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
  }
}
