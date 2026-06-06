import { Prompt } from 'effect/unstable/ai'
import { Effect, Match, Schema } from 'effect'
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
  pricing: {
    readonly billingMode: BillingMode
    readonly cost: CostInfo | undefined
  }
): HarnessHook<StorageError, SessionStorage> => ({
  name: 'persist',
  handle: (event: HarnessEvent) =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage

      if (event._tag === 'RunUsage') {
        const usage = pricedUsage(
          event.usage,
          pricing.billingMode,
          pricing.cost,
          event.contextTokens
        )
        if (usage) yield* storage.updateRunUsage(runId, usage)
        return
      }

      if (event._tag !== 'RunResult') return
      const encoded = yield* Effect.try({
        try: () => Schema.encodeSync(Prompt.Prompt)(event.result.conversation),
        catch: (error) =>
          new StorageError({
            operation: 'run',
            message: `Failed to encode conversation: ${String(error)}`,
          }),
      })

      const encodedNewMessages = encoded.content.slice(messageCountBeforeRun)
      const displayMessages = addToolDisplays(
        encodedNewMessages,
        event.result.toolCallHeaders,
        event.result.toolResultHeaders,
        event.result.toolResultBodyDisplays
      )
      const newMessages = Match.value(event.interrupted).pipe(
        Match.when(true, () => [...displayMessages, stoppedSystemMessage]),
        Match.orElse(() => displayMessages)
      )

      yield* storage.completeRun({
        id: runId,
        status: event.interrupted ? 'interrupted' : 'completed',
        usage: pricedUsage(
          event.result.usage,
          pricing.billingMode,
          pricing.cost,
          event.result.contextTokens
        ),
      })
      if (newMessages.length === 0) return

      yield* Effect.logInfo('Persisting run messages', {
        sessionId,
        runId,
        messageCount: newMessages.length,
        interrupted: event.interrupted,
      })

      yield* storage.append(sessionId, runId, newMessages)
      publish({ _tag: 'MessagesAppended', sessionId })
      publish({ _tag: 'SessionUpdated', sessionId })
    }).pipe(
      Effect.annotateLogs({
        package: 'server',
        subsystem: 'run-persistence',
        sessionId,
      }),
      Effect.withLogSpan('server.persistRun')
    ),
})
