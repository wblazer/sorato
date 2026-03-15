/**
 * Agent run orchestration for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 */
import { Prompt } from '@effect/ai'
import { Cause, Effect, Layer } from 'effect'
import {
  run,
  Sandbox,
  CurrentShell,
  CurrentFiles,
  SessionStorage,
  type SessionId,
} from '../index.ts'
import { AllTools, SYSTEM_PROMPT } from './agent-config.ts'
import { createBusHook, publish } from './event-bus.ts'
import { endEventReplay, startEventReplay } from './event-replay.ts'
import { createPersistenceHook } from './run-persistence.ts'

export const runAgent = (sessionId: SessionId, input: string) => {
  const runId = crypto.randomUUID()

  return Effect.gen(function* () {
    const storage = yield* SessionStorage
    const sandbox = yield* Sandbox

    const session = yield* storage.get(sessionId)
    const existingConversation = yield* storage.conversation(sessionId)
    const isFirstMessage = existingConversation.content.length === 0

    const preamble: Array<Prompt.MessageEncoded> = isFirstMessage
      ? [
          { role: 'system' as const, content: SYSTEM_PROMPT },
          { role: 'user' as const, content: input },
        ]
      : [{ role: 'user' as const, content: input }]

    yield* storage.append(sessionId, preamble)
    publish({ _tag: 'MessagesAppended', sessionId })
    startEventReplay(sessionId, runId)
    publish({ _tag: 'RunStart', sessionId, runId })

    const conversation = yield* storage.conversation(sessionId)
    const messageCountBeforeRun = conversation.content.length

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { shell, files } = yield* sandbox.acquire(session.directory)

        yield* run(conversation, {
          toolkit: AllTools,
          hooks: [
            createBusHook(sessionId, runId),
            createPersistenceHook(sessionId, messageCountBeforeRun),
          ],
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(CurrentShell, shell),
              Layer.succeed(CurrentFiles, files)
            )
          )
        )
      })
    )
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        endEventReplay(sessionId, runId)
        publish({ _tag: 'RunEnd', sessionId, runId })
      })
    ),
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) {
          console.log(`Agent run interrupted for session ${sessionId}`)
        } else {
          console.error(`Agent run failed for session ${sessionId}:`, cause)
        }
      })
    ),
    Effect.annotateLogs('sessionId', sessionId)
  )
}
