import { Prompt } from 'effect/unstable/ai'
import { Effect, Schema } from 'effect'
import type { HarnessEvent, HarnessHook } from '@agents/core'
import { SessionStorage, StorageError, type SessionId } from './session/session.ts'
import { publish } from './event-bus.ts'

const stoppedSystemMessage = {
  role: 'system' as const,
  content:
    '[The user stopped the previous response. The assistant message above may be incomplete.]',
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

      const newMessages = event.interrupted
        ? [...encoded.content.slice(messageCountBeforeRun), stoppedSystemMessage]
        : encoded.content.slice(messageCountBeforeRun)
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
      Effect.annotateLogs({ package: 'server', subsystem: 'run-persistence', sessionId }),
      Effect.withLogSpan('server.persistRun')
    ),
})
