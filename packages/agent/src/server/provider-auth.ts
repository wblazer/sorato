import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Effect, Schema } from 'effect'

export class AuthError extends Schema.TaggedErrorClass<AuthError>()('AuthError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ProviderAuthInfo extends Schema.Class<ProviderAuthInfo>(
  'ProviderAuthInfo'
)({
  type: Schema.Literal('api'),
  key: Schema.String,
}) {}

export class ProviderOauthInfo extends Schema.Class<ProviderOauthInfo>(
  'ProviderOauthInfo'
)({
  type: Schema.Literal('oauth'),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  accountId: Schema.optional(Schema.String),
}) {}

export const ProviderAuthDatabase = Schema.Record(
  Schema.String,
  Schema.Union([ProviderAuthInfo, ProviderOauthInfo])
)

export type ProviderAuthDatabase = typeof ProviderAuthDatabase.Type
export type ProviderAuth = ProviderAuthDatabase[string]

const decodeDatabase = Schema.decodeUnknownSync(ProviderAuthDatabase)

const authPath = (dataDir: string) => join(dataDir, 'auth.json')

const authFailure = (message: string) => (cause: unknown) =>
  new AuthError({ message, cause })

export const readAuth = Effect.fn('ProviderAuth.read')(function* (
  dataDir: string
) {
  const file = Bun.file(authPath(dataDir))
  const exists = yield* Effect.tryPromise({
    try: () => file.exists(),
    catch: authFailure('Failed to read provider credentials'),
  })

  if (!exists) return {}

  const json = yield* Effect.tryPromise({
    try: () => file.json(),
    catch: authFailure('Failed to parse provider credentials'),
  })

  return yield* Effect.try({
    try: () => decodeDatabase(json),
    catch: authFailure('Invalid provider credentials'),
  })
})

export const getAuth = Effect.fn('ProviderAuth.get')(function* (
  dataDir: string,
  provider: string
) {
  return (yield* readAuth(dataDir))[provider]
})

export const setApiKey = Effect.fn('ProviderAuth.setApiKey')(function* (
  dataDir: string,
  provider: string,
  key: string
) {
  const file = authPath(dataDir)
  const data = yield* readAuth(dataDir)
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(file), { recursive: true })
      await Bun.write(file, JSON.stringify({ ...data, [provider]: { type: 'api', key } }, null, 2))
      await Bun.$`chmod 600 ${file}`.quiet()
    },
    catch: authFailure('Failed to write provider credentials'),
  })
})

export const setOauth = Effect.fn('ProviderAuth.setOauth')(function* (
  dataDir: string,
  provider: string,
  info: Omit<ProviderOauthInfo, 'type'>
) {
  const file = authPath(dataDir)
  const data = yield* readAuth(dataDir)
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(file), { recursive: true })
      await Bun.write(
        file,
        JSON.stringify({ ...data, [provider]: { type: 'oauth', ...info } }, null, 2)
      )
      await Bun.$`chmod 600 ${file}`.quiet()
    },
    catch: authFailure('Failed to write provider credentials'),
  })
})

export const providerApiKey = Effect.fn('ProviderAuth.providerApiKey')(function* (
  dataDir: string,
  provider: string,
  envKeys: ReadonlyArray<string>
) {
  const stored = yield* getAuth(dataDir, provider)
  if (stored?.type === 'api' && stored.key.trim()) return stored.key

  return envKeys.map((key) => process.env[key]?.trim()).find(Boolean)
})

export const hasProviderAuth = Effect.fn('ProviderAuth.hasProviderAuth')(function* (
  dataDir: string,
  provider: string,
  envKeys: ReadonlyArray<string>
) {
  const stored = yield* getAuth(dataDir, provider)
  if (stored?.type === 'api' && stored.key.trim()) return true
  if (stored?.type === 'oauth' && stored.refresh.trim()) return true
  return envKeys.some((key) => !!process.env[key]?.trim())
})
