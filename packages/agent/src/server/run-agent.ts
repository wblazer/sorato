/**
 * Agent run orchestration for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 */
import type { Prompt } from 'effect/unstable/ai'
import { Cause, Effect, Layer, Match } from 'effect'
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
import { modelLayer } from './model-catalog.ts'
import { createPersistenceHook } from './run-persistence.ts'

export const runAgent = (sessionId: SessionId, input: string) => {
  const runId = crypto.randomUUID()
  const finalizeRun = Effect.sync(() => {
    endEventReplay(sessionId, runId)
    publish({ _tag: 'RunEnd', sessionId, runId })
  })

  return Effect.gen(function* () {
    const storage = yield* SessionStorage
    const sandbox = yield* Sandbox

    const session = yield* storage.get(sessionId)
    const modelServices = yield* Match.value(modelLayer(session.model)).pipe(
      Match.when(undefined, () =>
        Effect.die(
          new Error(`Model is not supported by this server: ${session.model}`)
        )
      ),
      Match.orElse((layer) => Effect.succeed(layer))
    )
    const existingConversation = yield* storage.conversation(sessionId)
    const isFirstMessage = existingConversation.content.length === 0
    const preamble: Array<Prompt.MessageEncoded> = Match.value(
      isFirstMessage
    ).pipe(
      Match.when(true, () => [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'user' as const, content: input },
      ]),
      Match.orElse(() => [{ role: 'user' as const, content: input }])
    )

    yield* storage.append(sessionId, preamble)
    publish({ _tag: 'MessagesAppended', sessionId })
    startEventReplay(sessionId, runId)
    publish({ _tag: 'RunStart', sessionId, runId })

    const conversation = yield* storage.conversation(sessionId)
    const messageCountBeforeRun = conversation.content.length
    yield* sandbox.acquire(session.directory).pipe(
      Effect.flatMap(({ shell, files }) =>
        Effect.provide(
          run(conversation, {
            toolkit: AllTools,
            hooks: [
              createBusHook(sessionId, runId),
              createPersistenceHook(sessionId, messageCountBeforeRun),
            ],
          }),
          Layer.mergeAll(
            Layer.succeed(CurrentShell, shell),
            Layer.succeed(CurrentFiles, files),
            modelServices
          )
        )
      ),
      Effect.scoped
    )
  }).pipe(
    Effect.ensuring(finalizeRun),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        if (Cause.hasInterruptsOnly(cause)) {
          console.log(`Agent run interrupted for session ${sessionId}`)
        } else {
          console.error(`Agent run failed for session ${sessionId}:`, cause)
        }
      })
    ),
    Effect.annotateLogs('sessionId', sessionId)
  )
}
