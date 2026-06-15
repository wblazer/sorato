import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Match } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { MODEL_PROVIDERS } from '../src/models.generated.ts'
import { ensureModel, listModels } from '../src/model-catalog.ts'
import { PROVIDER_ADAPTERS } from '../src/provider-adapters.ts'
import { ProviderAuthStore } from '../src/provider-auth.ts'
import { RuntimeConfigLive } from '../src/runtime-config.ts'

const ProviderAuthTest = Layer.succeed(
  ProviderAuthStore,
  ProviderAuthStore.of({
    getAuth: () => Effect.succeed(undefined),
    setApiKey: () => Effect.void,
    setOauth: () => Effect.void,
    providerApiKey: (_provider, envKeys) =>
      Effect.succeed(
        envKeys.map((key) => process.env[key]?.trim()).find(Boolean)
      ),
    hasProviderAuth: (_provider, envKeys) =>
      Effect.succeed(envKeys.some((key) => !!process.env[key]?.trim())),
  })
)

const testLayer = Layer.merge(RuntimeConfigLive, ProviderAuthTest)

const expectDefined = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

const anthropic = expectDefined(
  MODEL_PROVIDERS.find((provider) => provider.id === 'anthropic'),
  'expected anthropic provider in generated models'
)
const openai = expectDefined(
  MODEL_PROVIDERS.find((provider) => provider.id === 'openai'),
  'expected openai provider in generated models'
)

const supportedCount = (provider: (typeof MODEL_PROVIDERS)[number]) => {
  const adapter = PROVIDER_ADAPTERS[provider.id]
  return provider.models.filter((model) => adapter.supportsModel(model.id))
    .length
}

const newestRelease = (prefixedId: string): string | undefined => {
  const [providerId, ...rest] = prefixedId.split('/')
  const modelId = rest.join('/')
  return MODEL_PROVIDERS.find((p) => p.id === providerId)?.models.find(
    (m) => m.id === modelId
  )?.releaseDate
}

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('ModelCatalog', () => {
  it.effect(
    'lists generated models recognized by available runtime providers',
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.tryPromise(() =>
          mkdtemp(join(tmpdir(), 'sorato-'))
        )
        const xdg = join(root, 'xdg')
        const dir = join(root, 'project')
        const prevXdg = process.env.XDG_CONFIG_HOME
        const prevAnthropic = process.env.ANTHROPIC_API_KEY
        const prevOpenAi = process.env.OPENAI_API_KEY

        yield* Effect.tryPromise(() =>
          mkdir(join(xdg, 'sorato'), { recursive: true })
        )
        yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))
        yield* Effect.tryPromise(() =>
          writeFile(
            join(xdg, 'sorato', 'config.jsonc'),
            JSON.stringify({ default_model: `openai/${openai.models[0]?.id}` })
          )
        )

        process.env.XDG_CONFIG_HOME = xdg
        process.env.ANTHROPIC_API_KEY = 'test-anthropic'
        process.env.OPENAI_API_KEY = 'test-openai'

        const models = yield* listModels(dir).pipe(Effect.provide(testLayer))

        expect(models.models.length).toBe(
          supportedCount(anthropic) + supportedCount(openai)
        )
        // No stale generated-enum gate: the catalog is sorted newest-first by
        // release date. Derive the expectation from the data so it stays valid
        // as `generate-models` syncs fresh models.dev releases.
        const newestId = [...models.models].sort((a, b) =>
          (newestRelease(b.id) ?? '').localeCompare(newestRelease(a.id) ?? '')
        )[0]?.id
        expect(models.models[0]?.id).toBe(newestId)
        expect(models.defaultModel).toBe(`openai/${openai.models[0]?.id}`)

        restoreEnv('XDG_CONFIG_HOME', prevXdg)
        restoreEnv('ANTHROPIC_API_KEY', prevAnthropic)
        restoreEnv('OPENAI_API_KEY', prevOpenAi)
        yield* Effect.tryPromise(() =>
          rm(root, { recursive: true, force: true })
        )
      })
  )

  it.effect('filters to providers with available credentials', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'sorato-'))
      )
      const dir = join(root, 'project')
      const prevXdg = process.env.XDG_CONFIG_HOME
      const prevAnthropic = process.env.ANTHROPIC_API_KEY
      const prevOpenAi = process.env.OPENAI_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      process.env.XDG_CONFIG_HOME = join(root, 'xdg')
      delete process.env.ANTHROPIC_API_KEY
      process.env.OPENAI_API_KEY = 'test-openai'

      const models = yield* listModels(dir).pipe(Effect.provide(testLayer))

      expect(models.models.length).toBe(supportedCount(openai))
      expect(models.models.every((item) => item.id.startsWith('openai/'))).toBe(
        true
      )

      restoreEnv('XDG_CONFIG_HOME', prevXdg)
      restoreEnv('ANTHROPIC_API_KEY', prevAnthropic)
      restoreEnv('OPENAI_API_KEY', prevOpenAi)
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('only lists generated catalog models supported by adapters', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'sorato-'))
      )
      const dir = join(root, 'project')
      const prevXdg = process.env.XDG_CONFIG_HOME
      const prevOpenAi = process.env.OPENAI_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      process.env.XDG_CONFIG_HOME = join(root, 'xdg')
      delete process.env.ANTHROPIC_API_KEY
      process.env.OPENAI_API_KEY = 'test-openai'

      const models = yield* listModels(dir).pipe(Effect.provide(testLayer))

      expect(
        models.models.every((item) => {
          const [provider, ...rest] = item.id.split('/')
          const model = rest.join('/')
          return Match.value(provider).pipe(
            Match.when('anthropic', () =>
              PROVIDER_ADAPTERS.anthropic.supportsModel(model)
            ),
            Match.when('openai', () =>
              PROVIDER_ADAPTERS.openai.supportsModel(model)
            ),
            Match.orElse(() => false)
          )
        })
      ).toBe(true)
      expect(models.models.length).toBe(supportedCount(openai))
      restoreEnv('XDG_CONFIG_HOME', prevXdg)
      restoreEnv('OPENAI_API_KEY', prevOpenAi)
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('accepts model selections with supported runtime variants', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'sorato-'))
      )
      const dir = join(root, 'project')
      const prevXdg = process.env.XDG_CONFIG_HOME
      const prevAnthropic = process.env.ANTHROPIC_API_KEY
      const prevOpenAi = process.env.OPENAI_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      process.env.XDG_CONFIG_HOME = join(root, 'xdg')
      delete process.env.ANTHROPIC_API_KEY
      process.env.OPENAI_API_KEY = 'test-openai'

      const models = yield* listModels(dir).pipe(Effect.provide(testLayer))
      const reasoning = expectDefined(
        models.models.find((item) =>
          item.capabilities.thinkingLevels.includes('low')
        ),
        'expected at least one OpenAI reasoning model'
      )
      const fast = expectDefined(
        models.models.find((item) => item.capabilities.modes.includes('fast')),
        'expected at least one OpenAI fast mode model'
      )

      yield* ensureModel(dir, reasoning.id, { thinkingLevel: 'low' }).pipe(
        Effect.provide(testLayer)
      )
      yield* ensureModel(dir, fast.id, { mode: 'fast' }).pipe(
        Effect.provide(testLayer)
      )

      restoreEnv('XDG_CONFIG_HOME', prevXdg)
      restoreEnv('ANTHROPIC_API_KEY', prevAnthropic)
      restoreEnv('OPENAI_API_KEY', prevOpenAi)
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )
})
