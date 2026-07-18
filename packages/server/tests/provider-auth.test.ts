import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BunServices } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { describe, expect, it } from '@effect/vitest'
import { Config, ConfigProvider, Effect, Layer } from 'effect'
import {
  hasProviderAuth,
  providerApiKey,
  ProviderAuthStore,
  SqliteProviderAuthStore,
} from '../src/provider-auth.ts'

const withAuthStore = <A, E>(
  configProvider: ConfigProvider.ConfigProvider,
  effect: Effect.Effect<A, E, ProviderAuthStore>
) =>
  Effect.gen(function* () {
    const root = yield* Effect.tryPromise(() =>
      mkdtemp(join(tmpdir(), 'sorato-provider-auth-'))
    )
    const path = join(root, 'auth.db')
    const authLayer = SqliteProviderAuthStore({ path }).pipe(
      Layer.provide(SqliteClient.layer({ filename: path })),
      Layer.provide(BunServices.layer)
    )

    return yield* effect.pipe(
      Effect.provide(authLayer),
      Effect.provide(ConfigProvider.layer(configProvider)),
      Effect.ensuring(
        Effect.tryPromise(() =>
          rm(root, { recursive: true, force: true })
        ).pipe(Effect.orDie)
      )
    )
  })

describe('ProviderAuthStore credential config', () => {
  it.effect('reads and trims dynamic credential keys from ConfigProvider', () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromUnknown({
        PRIMARY_API_KEY: '   ',
        FALLBACK_API_KEY: '  test-key  ',
      })

      const key = yield* withAuthStore(
        provider,
        providerApiKey('test-provider', ['PRIMARY_API_KEY', 'FALLBACK_API_KEY'])
      )
      const available = yield* withAuthStore(
        provider,
        hasProviderAuth('test-provider', ['FALLBACK_API_KEY'])
      )

      expect(key).toBe('test-key')
      expect(available).toBe(true)
    })
  )

  it.effect('treats missing credential config as unavailable', () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromUnknown({})
      const key = yield* withAuthStore(
        provider,
        providerApiKey('test-provider', ['MISSING_API_KEY'])
      )
      const available = yield* withAuthStore(
        provider,
        hasProviderAuth('test-provider', ['MISSING_API_KEY'])
      )

      expect(key).toBeUndefined()
      expect(available).toBe(false)
    })
  )

  it.effect('maps credential config failures into AuthError', () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.make(() =>
        Effect.fail(
          new ConfigProvider.SourceError({
            message: 'credential source unavailable',
          })
        )
      )

      const error = yield* withAuthStore(
        provider,
        providerApiKey('test-provider', ['TEST_API_KEY'])
      ).pipe(Effect.flip)

      expect(error._tag).toBe('AuthError')
      expect(error.message).toContain('credential source unavailable')
      expect(error.cause).toBeInstanceOf(Config.ConfigError)
    })
  )
})
