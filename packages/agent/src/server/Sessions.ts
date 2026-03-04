/**
 * Sessions group handler implementation.
 *
 * Delegates to SessionStorage from @agents/agent. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'
import { SessionStorage } from '../session/session.ts'
import {
  Api,
  MessageNodeResponse,
  RunError,
  RunResponse,
  SessionResponse,
} from './Api.ts'
import { runAgent } from './Agent.ts'
import { isRunning } from './RunState.ts'

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

          // Guard: reject if a run is already active for this session.
          // Two concurrent runs on the same session corrupt the conversation
          // (interleaved events, stomped replay buffer, mixed responses).
          if (isRunning(path.id)) {
            return yield* new RunError({
              message: `Session ${path.id} already has an active run`,
            })
          }

          // Fork the agent run as a daemon — returns immediately
          yield* runAgent(path.id, payload.input).pipe(Effect.forkDaemon)

          return new RunResponse({ status: 'started' })
        })
      )
  })
)
