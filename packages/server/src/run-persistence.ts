import { Prompt } from 'effect/unstable/ai'
import { Effect, Match, Schema } from 'effect'
import type { HarnessEvent, HarnessHook, HarnessResult } from '@sorato/core'
import {
  SessionStorage,
  StorageError,
  type SessionId,
} from './session/session.ts'
import { publish } from './event-bus.ts'

const stoppedSystemMessage = {
  role: 'system' as const,
  source: 'interruption' as const,
  content:
    '[The user stopped the previous response. The assistant message above may be incomplete.]',
}

const addToolDisplays = (
  messages: ReadonlyArray<Prompt.MessageEncoded>,
  callDisplays: HarnessResult['toolCallDisplays'],
  resultDisplays: HarnessResult['toolResultDisplays']
): ReadonlyArray<Prompt.MessageEncoded> => {
  const addDisplayToCallPart = (
    part: Prompt.ToolCallPartEncoded
  ): Prompt.ToolCallPartEncoded => {
    const presentation = callDisplays.get(part.id)
    if (!presentation) return part

    return {
      ...part,
      ...(presentation.display !== undefined
        ? { display: presentation.display }
        : {}),
    }
  }

  const addDisplayToPart = (
    part: Prompt.ToolResultPartEncoded
  ): Prompt.ToolResultPartEncoded => {
    const presentation = resultDisplays.get(part.id)
    if (!presentation) return part

    return {
      ...part,
      ...(presentation.display !== undefined
        ? { display: presentation.display }
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
  messageCountBeforeRun: number
): HarnessHook<StorageError, SessionStorage> => ({
  name: 'persist',
  handle: (event: HarnessEvent) =>
    Effect.gen(function* () {
      if (event._tag !== 'RunResult') return

      const storage = yield* SessionStorage
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
        event.result.toolCallDisplays,
        event.result.toolResultDisplays
      )
      const newMessages = Match.value(event.interrupted).pipe(
        Match.when(true, () => [...displayMessages, stoppedSystemMessage]),
        Match.orElse(() => displayMessages)
      )
      if (newMessages.length === 0) return

      yield* Effect.logInfo('Persisting run messages', {
        sessionId,
        messageCount: newMessages.length,
        interrupted: event.interrupted,
      })

      yield* storage.append(sessionId, newMessages)
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
