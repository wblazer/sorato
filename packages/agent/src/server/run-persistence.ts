import { Prompt } from '@effect/ai'
import { Effect, Schema } from 'effect'
import { StorageError } from '../session/session.ts'
import {
  SessionStorage,
  type HarnessEvent,
  type HarnessHook,
  type SessionId,
} from '../index.ts'
import { publish } from './EventBus.ts'

export const createPersistenceHook = (
  sessionId: SessionId,
  messageCountBeforeRun: number
): HarnessHook<StorageError, SessionStorage> => ({
  name: 'persist',
  handle: (event: HarnessEvent) =>
    Effect.gen(function* () {
      if (event._tag !== 'RunResult') return

      const storage = yield* SessionStorage
      const encoded = yield* Schema.encode(Prompt.Prompt)(
        event.result.conversation
      ).pipe(
        Effect.mapError(
          (error) =>
            new StorageError({
              operation: 'run',
              message: `Failed to encode conversation: ${String(error)}`,
            })
        )
      )

      const newMessages = encoded.content.slice(messageCountBeforeRun)
      if (newMessages.length === 0) return

      yield* storage.append(sessionId, newMessages)
      publish({ _tag: 'MessagesAppended', sessionId })
      publish({ _tag: 'SessionUpdated', sessionId })
    }),
})
