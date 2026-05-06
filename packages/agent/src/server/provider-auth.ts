import { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context, Effect, Layer, Schema } from 'effect'

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
  lastRefresh: Schema.optional(Schema.Number),
  accountId: Schema.optional(Schema.String),
}) {}

export const ProviderAuthDatabase = Schema.Record(
  Schema.String,
  Schema.Union([ProviderAuthInfo, ProviderOauthInfo])
)

export type ProviderAuthDatabase = typeof ProviderAuthDatabase.Type
export type ProviderAuth = ProviderAuthDatabase[string]

export interface ProviderAuthStoreApi {
  readonly getAuth: (provider: string) => Effect.Effect<ProviderAuth | undefined, AuthError>
  readonly setApiKey: (provider: string, key: string) => Effect.Effect<void, AuthError>
  readonly setOauth: (
    provider: string,
    info: Omit<ProviderOauthInfo, 'type'>
  ) => Effect.Effect<void, AuthError>
  readonly providerApiKey: (
    provider: string,
    envKeys: ReadonlyArray<string>
  ) => Effect.Effect<string | undefined, AuthError>
  readonly hasProviderAuth: (
    provider: string,
    envKeys: ReadonlyArray<string>
  ) => Effect.Effect<boolean, AuthError>
}

export class ProviderAuthStore extends Context.Service<
  ProviderAuthStore,
  ProviderAuthStoreApi
>()('@agents/server/ProviderAuthStore') {}

interface ProviderAuthRow {
  provider: string
  type: 'api' | 'oauth'
  api_key: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: number | null
  last_refresh_at: number | null
  account_id: string | null
  updated_at: number
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS provider_auth (
    provider        TEXT PRIMARY KEY,
    type            TEXT NOT NULL CHECK (type IN ('api', 'oauth')),
    api_key         TEXT,
    access_token    TEXT,
    refresh_token   TEXT,
    expires_at      INTEGER,
    last_refresh_at INTEGER,
    account_id      TEXT,
    updated_at      INTEGER NOT NULL
  );
`

const authFailure = (message: string) => (cause: unknown) =>
  new AuthError({ message, cause })

const toAuth = (row: ProviderAuthRow | null): ProviderAuth | undefined => {
  if (!row) return
  if (row.type === 'api') {
    if (!row.api_key) return
    return new ProviderAuthInfo({ type: 'api', key: row.api_key })
  }
  if (!row.access_token || !row.refresh_token || row.expires_at === null) return
  return new ProviderOauthInfo({
    type: 'oauth',
    access: row.access_token,
    refresh: row.refresh_token,
    expires: row.expires_at,
    lastRefresh: row.last_refresh_at ?? undefined,
    accountId: row.account_id ?? undefined,
  })
}

const openDatabase = (path: string) => {
  const database = new Database(path)
  database.run('PRAGMA journal_mode = WAL')
  database.run(SCHEMA)
  return database
}

const prepareStatements = (db: Database) => ({
  getAuth: db.prepare<ProviderAuthRow, [string]>(
    'SELECT * FROM provider_auth WHERE provider = ?'
  ),
  setApiKey: db.prepare<void, [string, string, number]>(`
    INSERT INTO provider_auth (provider, type, api_key, updated_at)
    VALUES (?, 'api', ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      type = 'api',
      api_key = excluded.api_key,
      access_token = NULL,
      refresh_token = NULL,
      expires_at = NULL,
      last_refresh_at = NULL,
      account_id = NULL,
      updated_at = excluded.updated_at
  `),
  setOauth: db.prepare<
    void,
    [string, string, string, number, number | null, string | null, number]
  >(`
    INSERT INTO provider_auth (
      provider,
      type,
      access_token,
      refresh_token,
      expires_at,
      last_refresh_at,
      account_id,
      updated_at
    )
    VALUES (?, 'oauth', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      type = 'oauth',
      api_key = NULL,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      last_refresh_at = excluded.last_refresh_at,
      account_id = excluded.account_id,
      updated_at = excluded.updated_at
  `),
})

export const SqliteProviderAuthStore = (options: {
  readonly path: string
}) =>
  Layer.effect(
    ProviderAuthStore,
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(options.path), { recursive: true }),
        catch: authFailure('Failed to create provider auth database directory'),
      })

      const db = yield* Effect.try({
        try: () => openDatabase(options.path),
        catch: authFailure(`Failed to open provider auth database: ${options.path}`),
      })

      yield* Effect.tryPromise({
        try: () => Bun.$`chmod 600 ${options.path}`.quiet(),
        catch: authFailure('Failed to secure provider auth database'),
      })

      yield* Effect.addFinalizer(() =>
        Effect.try({
          try: () => db.close(),
          catch: authFailure('Failed to close provider auth database'),
        }).pipe(Effect.catch(() => Effect.void))
      )

      const stmts = prepareStatements(db)

      const getAuth = Effect.fn('ProviderAuthStore.getAuth')(function* (provider: string) {
        return yield* Effect.try({
          try: () => toAuth(stmts.getAuth.get(provider)),
          catch: authFailure('Failed to read provider credentials'),
        })
      })

      const setApiKey = Effect.fn('ProviderAuthStore.setApiKey')(function* (
        provider: string,
        key: string
      ) {
        yield* Effect.try({
          try: () => stmts.setApiKey.run(provider, key, Date.now()),
          catch: authFailure('Failed to write provider credentials'),
        })
      })

      const setOauth = Effect.fn('ProviderAuthStore.setOauth')(function* (
        provider: string,
        info: Omit<ProviderOauthInfo, 'type'>
      ) {
        yield* Effect.try({
          try: () =>
            stmts.setOauth.run(
              provider,
              info.access,
              info.refresh,
              info.expires,
              info.lastRefresh ?? null,
              info.accountId ?? null,
              Date.now()
            ),
          catch: authFailure('Failed to write provider credentials'),
        })
      })

      const providerApiKey = Effect.fn('ProviderAuthStore.providerApiKey')(function* (
        provider: string,
        envKeys: ReadonlyArray<string>
      ) {
        const stored = yield* getAuth(provider)
        if (stored?.type === 'api' && stored.key.trim()) return stored.key
        return envKeys.map((key) => process.env[key]?.trim()).find(Boolean)
      })

      const hasProviderAuth = Effect.fn('ProviderAuthStore.hasProviderAuth')(function* (
        provider: string,
        envKeys: ReadonlyArray<string>
      ) {
        const stored = yield* getAuth(provider)
        if (stored?.type === 'api' && stored.key.trim()) return true
        if (stored?.type === 'oauth' && stored.refresh.trim()) return true
        return envKeys.some((key) => !!process.env[key]?.trim())
      })

      return ProviderAuthStore.of({
        getAuth,
        setApiKey,
        setOauth,
        providerApiKey,
        hasProviderAuth,
      })
    }).pipe(Effect.orDie)
  )

export const getAuth = Effect.fn('ProviderAuth.get')(function* (provider: string) {
  const store = yield* ProviderAuthStore
  return yield* store.getAuth(provider)
})

export const setApiKey = Effect.fn('ProviderAuth.setApiKey')(function* (
  provider: string,
  key: string
) {
  const store = yield* ProviderAuthStore
  return yield* store.setApiKey(provider, key)
})

export const setOauth = Effect.fn('ProviderAuth.setOauth')(function* (
  provider: string,
  info: Omit<ProviderOauthInfo, 'type'>
) {
  const store = yield* ProviderAuthStore
  return yield* store.setOauth(provider, info)
})

export const providerApiKey = Effect.fn('ProviderAuth.providerApiKey')(function* (
  provider: string,
  envKeys: ReadonlyArray<string>
) {
  const store = yield* ProviderAuthStore
  return yield* store.providerApiKey(provider, envKeys)
})

export const hasProviderAuth = Effect.fn('ProviderAuth.hasProviderAuth')(function* (
  provider: string,
  envKeys: ReadonlyArray<string>
) {
  const store = yield* ProviderAuthStore
  return yield* store.hasProviderAuth(provider, envKeys)
})
