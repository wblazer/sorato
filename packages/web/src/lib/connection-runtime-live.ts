import { Layer, ManagedRuntime } from 'effect'
import { makeSoratoApiClientLayer } from '$lib/api-client.js'
import {
  ActiveConnection,
  type ConnectionServices,
} from '$lib/connection-services.js'
import {
  ApiServicesLive,
  makeServerEventSourceLayer,
  MessageToolPreloaderLive,
} from '$lib/connection-layers.js'
import type { ConnectionRuntime } from '$lib/connection-runtime.js'
import {
  connectionScopeId,
  type Connection,
} from '$lib/stores/connections.svelte.js'

export const makeConnectionRuntime = (
  connection: Pick<Connection, 'id' | 'source' | 'url'>
): ConnectionRuntime => {
  const clientLayer = makeSoratoApiClientLayer(connection.url)
  const apiServicesLayer = ApiServicesLive.pipe(Layer.provide(clientLayer))
  const connectionLayer: Layer.Layer<ConnectionServices> = Layer.mergeAll(
    Layer.succeed(
      ActiveConnection,
      ActiveConnection.of({
        id: connection.id,
        scopeId: connectionScopeId(connection) ?? connection.id,
        baseUrl: connection.url,
      })
    ),
    apiServicesLayer,
    makeServerEventSourceLayer(connection.url),
    MessageToolPreloaderLive
  )

  return ManagedRuntime.make(connectionLayer)
}
