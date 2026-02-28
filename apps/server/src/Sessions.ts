/**
 * Sessions group handler implementation.
 *
 * Delegates to SessionStorage from @agents/core. The handler Layer requires
 * SessionStorage in its environment — the caller provides it (e.g. SqliteSession).
 */
import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'
import { SessionStorage } from '@agents/core/session'
import { Api, MessageNodeResponse, SessionResponse } from './Api.js'

const toSessionResponse = (s: {
  readonly id: string
  readonly title: string | null
  readonly headId: string | null
  readonly createdAt: number
  readonly updatedAt: number
}) =>
  new SessionResponse({
    id: s.id,
    title: s.title,
    headId: s.headId,
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
        storage.create(payload.title).pipe(Effect.map(toSessionResponse))
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
  })
)
