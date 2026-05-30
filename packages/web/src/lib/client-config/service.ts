import { getJsonWithSchema, setJsonWithSchema, storage } from '$lib/storage.js'
import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  ClientConfigSchema,
  defaultClientConfig,
  diffClientConfig,
  encodeClientConfig,
  mergeClientConfig,
  type ClientConfig,
  type ResolvedClientConfig,
} from './schema.js'

const STORAGE_KEY = 'client-config-overrides'

export class ClientConfigError extends Data.TaggedError('ClientConfigError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface ClientConfigApi {
  readonly getResolved: Effect.Effect<ResolvedClientConfig, ClientConfigError>
  readonly setOverrides: (
    overrides: ClientConfig
  ) => Effect.Effect<ResolvedClientConfig, ClientConfigError>
  readonly copyResolvedConfig: Effect.Effect<string, ClientConfigError>
  readonly copyOverridesConfig: Effect.Effect<string, ClientConfigError>
}

export class ClientConfigService extends Context.Service<
  ClientConfigService,
  ClientConfigApi
>()('@sorato/web/ClientConfig') {}

const decodeClientConfig = (value: unknown): ClientConfig =>
  Schema.decodeUnknownSync(ClientConfigSchema)(value)

const makeWebService = (): ClientConfigApi => {
  const loadOverrides = () =>
    getJsonWithSchema(
      STORAGE_KEY,
      ClientConfigSchema,
      {} satisfies ClientConfig
    )

  const getResolved = Effect.sync(() => {
    const defaults = defaultClientConfig()
    const overrides = loadOverrides()
    return {
      defaults,
      file: {},
      overrides,
      resolved: mergeClientConfig(defaults, overrides),
      paths: {},
    } satisfies ResolvedClientConfig
  })

  return {
    getResolved,
    setOverrides: (overrides) =>
      Effect.sync(() => {
        const decoded = decodeClientConfig(overrides)
        setJsonWithSchema(STORAGE_KEY, ClientConfigSchema, decoded)
        const defaults = defaultClientConfig()
        return {
          defaults,
          file: {},
          overrides: decoded,
          resolved: mergeClientConfig(defaults, decoded),
          paths: {},
        } satisfies ResolvedClientConfig
      }),
    copyResolvedConfig: getResolved.pipe(
      Effect.map((config) => encodeClientConfig(config.resolved))
    ),
    copyOverridesConfig: getResolved.pipe(
      Effect.map((config) => encodeClientConfig(config.overrides))
    ),
  }
}

const makeElectronService = (): ClientConfigApi => {
  const getBridge = Effect.sync(() => window.soratoDesktop).pipe(
    Effect.flatMap((bridge) =>
      bridge === undefined
        ? Effect.fail(
            new ClientConfigError({
              message: 'Electron client config bridge is unavailable.',
            })
          )
        : Effect.succeed(bridge)
    )
  )

  const getResolved = getBridge.pipe(
    Effect.flatMap((bridge) =>
      Effect.tryPromise({
        try: () => bridge.getClientConfig(),
        catch: (cause) =>
          new ClientConfigError({
            message: 'Failed to load Electron client config.',
            cause,
          }),
      })
    )
  )

  return {
    getResolved,
    setOverrides: (overrides) =>
      getBridge.pipe(
        Effect.flatMap((bridge) =>
          Effect.tryPromise({
            try: () =>
              bridge.setClientConfigOverrides(decodeClientConfig(overrides)),
            catch: (cause) =>
              new ClientConfigError({
                message: 'Failed to save Electron client config overrides.',
                cause,
              }),
          })
        )
      ),
    copyResolvedConfig: getResolved.pipe(
      Effect.map((config) => encodeClientConfig(config.resolved))
    ),
    copyOverridesConfig: getResolved.pipe(
      Effect.map((config) =>
        encodeClientConfig(
          diffClientConfig(
            mergeClientConfig(config.defaults, config.file),
            config.resolved
          )
        )
      )
    ),
  }
}

export const WebClientConfigLayer = Layer.succeed(
  ClientConfigService,
  ClientConfigService.of(makeWebService())
)

export const ElectronClientConfigLayer = Layer.succeed(
  ClientConfigService,
  ClientConfigService.of(makeElectronService())
)

export const ClientConfigLayer =
  typeof window !== 'undefined' && window.soratoDesktop !== undefined
    ? ElectronClientConfigLayer
    : WebClientConfigLayer

export const clientConfigService =
  typeof window !== 'undefined' && window.soratoDesktop !== undefined
    ? makeElectronService()
    : makeWebService()

export const clearWebClientConfigOverrides = () =>
  Effect.sync(() => {
    storage.remove(STORAGE_KEY)
  })
