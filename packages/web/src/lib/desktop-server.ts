import { connectionsStore } from '$lib/stores/connections.svelte.js'
import { Data, Effect } from 'effect'

export class IntegratedServerUnavailable extends Data.TaggedError(
  'IntegratedServerUnavailable'
)<{
  readonly message: string
}> {}

export class IntegratedServerOperationFailed extends Data.TaggedError(
  'IntegratedServerOperationFailed'
)<{
  readonly operation: 'start' | 'stop'
  readonly message: string
  readonly cause: unknown
}> {}

export type IntegratedServerError =
  | IntegratedServerUnavailable
  | IntegratedServerOperationFailed

function desktopApi() {
  return window.soratoDesktop
    ? Effect.succeed(window.soratoDesktop)
    : Effect.fail(
        new IntegratedServerUnavailable({
          message: 'Integrated servers are only available in the desktop app.',
        })
      )
}

function operationMessage(operation: 'start' | 'stop') {
  return operation === 'start'
    ? 'Could not start the local server.'
    : 'Could not stop the local server.'
}

function runDesktopOperation<A>(
  operation: 'start' | 'stop',
  run: (desktop: NonNullable<Window['soratoDesktop']>) => Promise<A>
) {
  return Effect.gen(function* () {
    const desktop = yield* desktopApi()
    return yield* Effect.tryPromise({
      try: () => run(desktop),
      catch: (cause) =>
        new IntegratedServerOperationFailed({
          operation,
          message: operationMessage(operation),
          cause,
        }),
    })
  })
}

export function canStartIntegratedServer(): boolean {
  return typeof window !== 'undefined' && !!window.soratoDesktop
}

export function startIntegratedServerConnection() {
  return Effect.gen(function* () {
    const server = yield* runDesktopOperation('start', (desktop) =>
      desktop.startIntegratedServer()
    )
    return yield* connectionsStore.upsertIntegrated(server.url)
  })
}

export function startAndConnectIntegratedServer() {
  return Effect.gen(function* () {
    const connection = yield* startIntegratedServerConnection()
    yield* connectionsStore.activate(connection.id)
  })
}

export function restartAndConnectIntegratedServer() {
  return Effect.gen(function* () {
    yield* runDesktopOperation('stop', (desktop) =>
      desktop.stopIntegratedServer()
    )
    yield* startAndConnectIntegratedServer()
  })
}

export function stopAndRemoveIntegratedServer() {
  return Effect.gen(function* () {
    yield* runDesktopOperation('stop', (desktop) =>
      desktop.stopIntegratedServer()
    )
    const connection = connectionsStore.connections.find(
      (candidate) => candidate.source === 'integrated'
    )
    if (connection) yield* connectionsStore.remove(connection.id)
  })
}
