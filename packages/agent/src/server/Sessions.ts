/**
 * Sessions group handler implementation.
 *
 * Delegates to SessionStorage from @agents/agent. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from '@effect/platform'
import { Effect, Fiber } from 'effect'
import { SessionStorage } from '../session/session.ts'
import {
  Api,
  MessageNodeResponse,
  RunError,
  RunResponse,
  SessionResponse,
  StopResponse,
} from './Api.ts'
import { runAgent } from './Agent.ts'
import {
  claimRun,
  getFiber,
  isRunning,
  registerFiber,
  releaseRun,
} from './RunState.ts'
import { publish } from './EventBus.ts'

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
      .handle('get', ({ path }) =>
        storage.get(path.id).pipe(Effect.map(toSessionResponse))
      )
      .handle('delete', ({ path }) => storage.delete(path.id))
      .handle('leaves', ({ path }) =>
        storage
          .leaves(path.id)
          .pipe(Effect.map((nodes) => nodes.map(toMessageNodeResponse)))
      )
      .handle('messages', ({ path }) =>
        storage
          .messages(path.id)
          .pipe(Effect.map((nodes) => nodes.map(toMessageNodeResponse)))
      )
      .handle('run', ({ path, payload }) =>
        Effect.gen(function* () {
          // Verify session exists
          yield* storage.get(path.id)

          if (!claimRun(path.id)) {
            return yield* new RunError({
              message: `Session ${path.id} already has an active run`,
            })
          }

          yield* runAgent(path.id, payload.input).pipe(
            Effect.forkDaemon,
            Effect.tap((fiber) =>
              Effect.sync(() => registerFiber(path.id, fiber))
            ),
            Effect.onError(() => Effect.sync(() => releaseRun(path.id)))
          )

          return new RunResponse({ status: 'started' })
        })
      )
      .handle('stop', ({ path }) =>
        Effect.gen(function* () {
          const fiber = getFiber(path.id)
          if (!fiber) {
            if (isRunning(path.id)) {
              releaseRun(path.id)
              return new StopResponse({ status: 'stopped' })
            }

            return new StopResponse({ status: 'not_running' })
          }

          // Interrupt the running fiber and wait for it to finish.
          // The fiber's uninterruptible cleanup persists partial
          // assistant content before terminating, so the system message
          // we append below is guaranteed to come AFTER the partial turn.
          yield* Fiber.interrupt(fiber)

          // Persist a system message so the LLM knows it was interrupted
          // on the next turn.
          yield* storage.append(path.id, [
            {
              role: 'system' as const,
              content:
                '[The user interrupted the previous response. The assistant message above may be incomplete.]',
            },
          ])
          publish({ _tag: 'MessagesAppended', sessionId: path.id })

          return new StopResponse({ status: 'stopped' })
        })
      )
  })
)
