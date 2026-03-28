/**
 * Sessions group handler implementation.
 *
 * Delegates to SessionStorage from @agents/agent. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Effect, Fiber } from 'effect'
import { SessionStorage, type SessionId } from '../session/session.ts'
import {
  Api,
  MessageNodeResponse,
  RunResponse,
  SessionResponse,
  StopResponse,
} from './api.ts'
import { runAgent } from './run-agent.ts'
import {
  clearActiveFiber,
  drainQueuedRuns as drainQueuedInputs,
  enqueueRun,
  getFiber,
  isRunning,
  requestStop,
  registerActiveFiber,
  registerWorkerFiber,
  releaseRun,
  shouldStop,
  shiftQueuedRun,
} from './run-registry.ts'
import { publish } from './event-bus.ts'

const drainQueuedRuns = (sessionId: SessionId) =>
  Effect.gen(function* () {
    while (true) {
      const stopRequested = yield* Effect.sync(() => shouldStop(sessionId))
      if (stopRequested) break

      const input = yield* Effect.sync(() => shiftQueuedRun(sessionId))
      if (!input) break

      const fiber = yield* runAgent(sessionId, input).pipe(
        Effect.forkDetach,
        Effect.tap((activeFiber) =>
          Effect.sync(() => registerActiveFiber(sessionId, activeFiber))
        )
      )

      yield* Fiber.join(fiber)
      yield* Effect.sync(() => clearActiveFiber(sessionId))
    }
  }).pipe(Effect.ensuring(Effect.sync(() => releaseRun(sessionId))))

const toSessionResponse = (s: {
  readonly id: string
  readonly directory: string
  readonly title: string | null
  readonly headId: string | null
  readonly createdAt: number
  readonly updatedAt: number
}) =>
  new SessionResponse({
    id: s.id,
    directory: s.directory,
    title: s.title,
    headId: s.headId,
    status: isRunning(s.id) ? 'running' : 'idle',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  })

const toMessageNodeResponse = (m: {
  readonly id: string
  readonly sessionId: string
  readonly parentId: string | null
  readonly encoded: unknown
  readonly createdAt: number
}) =>
  new MessageNodeResponse({
    id: m.id,
    sessionId: m.sessionId,
    parentId: m.parentId,
    encoded: m.encoded,
    createdAt: m.createdAt,
  })

export const SessionsLive = HttpApiBuilder.group(Api, 'sessions', (handlers) =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage

    return handlers
      .handle('list', () =>
        storage
          .list()
          .pipe(Effect.map((sessions) => sessions.map(toSessionResponse)))
      )
      .handle('create', ({ payload }) =>
        storage
          .create(payload.directory, payload.title)
          .pipe(Effect.map(toSessionResponse))
      )
      .handle('get', ({ params }) =>
        storage.get(params.id).pipe(Effect.map(toSessionResponse))
      )
      .handle('delete', ({ params }) => storage.delete(params.id))
      .handle('leaves', ({ params }) =>
        storage
          .leaves(params.id)
          .pipe(Effect.map((nodes) => nodes.map(toMessageNodeResponse)))
      )
      .handle('messages', ({ params }) =>
        storage
          .messages(params.id)
          .pipe(Effect.map((nodes) => nodes.map(toMessageNodeResponse)))
      )
      .handle('run', ({ params, payload }) =>
        Effect.gen(function* () {
          // Verify session exists
          yield* storage.get(params.id)

          const status = enqueueRun(params.id, payload.input)

          if (status === 'queued') {
            return new RunResponse({ status })
          }

          yield* drainQueuedRuns(params.id).pipe(
            Effect.forkDetach,
            Effect.tap((fiber) =>
              Effect.sync(() => registerWorkerFiber(params.id, fiber))
            ),
            Effect.onError(() => Effect.sync(() => releaseRun(params.id)))
          )

          return new RunResponse({ status })
        })
      )
      .handle('stop', ({ params }) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => requestStop(params.id))
          const fiber = getFiber(params.id)

          if (!fiber) {
            if (isRunning(params.id)) {
              const queuedInputs = yield* Effect.sync(() =>
                drainQueuedInputs(params.id)
              )

              if (queuedInputs.length > 0) {
                yield* storage.append(
                  params.id,
                  queuedInputs.map((input) => ({
                    role: 'user' as const,
                    content: input,
                  }))
                )
                publish({ _tag: 'MessagesAppended', sessionId: params.id })
              }

              return new StopResponse({ status: 'stopped' })
            }

            return new StopResponse({ status: 'not_running' })
          }

          // Interrupt the running fiber and wait for it to finish.
          // The fiber's uninterruptible cleanup persists partial
          // assistant content before terminating, so the system message
          // we append below is guaranteed to come AFTER the partial turn.
          yield* Fiber.interrupt(fiber)

          const queuedInputs = yield* Effect.sync(() =>
            drainQueuedInputs(params.id)
          )

          // Persist a system message so the LLM knows it was interrupted
          // on the next turn.
          yield* storage.append(params.id, [
            {
              role: 'system' as const,
              content:
                '[The user interrupted the previous response. The assistant message above may be incomplete.]',
            },
            ...queuedInputs.map((input) => ({
              role: 'user' as const,
              content: input,
            })),
          ])
          publish({ _tag: 'MessagesAppended', sessionId: params.id })

          return new StopResponse({ status: 'stopped' })
        })
      )
  })
)
