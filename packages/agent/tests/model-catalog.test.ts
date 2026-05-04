import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Match } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { MODEL_PROVIDERS } from '../src/server/models.generated.ts'
import { ensureModel, listModels } from '../src/server/model-catalog.ts'
import { PROVIDER_ADAPTERS } from '../src/server/provider-adapters.ts'

const expectDefined = <T>(value: T | null | undefined, message: string): T => {
  return Match.value(value).pipe(
    Match.when(undefined, () => {
      throw new Error(message)
    }),
    Match.when(null, () => {
      throw new Error(message)
    }),
    Match.orElse((defined) => defined)
  )
}

const anthropic = expectDefined(
  MODEL_PROVIDERS.find((provider) => provider.id === 'anthropic'),
  'expected anthropic provider in generated models'
)
const openai = expectDefined(
  MODEL_PROVIDERS.find((provider) => provider.id === 'openai'),
  'expected openai provider in generated models'
)

const supportedCount = (provider: typeof MODEL_PROVIDERS[number]) => {
  const adapter = PROVIDER_ADAPTERS[provider.id]
  return provider.models.filter((model) => adapter.supportsModel(model.id))
    .length
}

type MutableCatalogModel = {
  id: string
  name: string
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
          mkdtemp(join(tmpdir(), 'agents-'))
        )
        const xdg = join(root, 'xdg')
        const dir = join(root, 'project')
        const prevXdg = process.env.XDG_CONFIG_HOME
        const prevAnthropic = process.env.ANTHROPIC_API_KEY
        const prevOpenAi = process.env.OPENAI_API_KEY

        yield* Effect.tryPromise(() =>
          mkdir(join(xdg, 'agents'), { recursive: true })
        )
        yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))
        yield* Effect.tryPromise(() =>
          writeFile(
            join(xdg, 'agents', 'config.jsonc'),
            JSON.stringify({ default_model: `openai/${openai.models[0]?.id}` })
          )
        )

        process.env.XDG_CONFIG_HOME = xdg
        process.env.ANTHROPIC_API_KEY = 'test-anthropic'
        process.env.OPENAI_API_KEY = 'test-openai'

        const models = yield* listModels('', dir)

        expect(models.models.length).toBe(
          supportedCount(anthropic) + supportedCount(openai)
        )
        expect(models.models[0]?.id).toBe('openai/gpt-5.5-pro')
        expect(models.models[1]?.id).toBe('openai/gpt-5.5')
        expect(models.models[2]?.id).toBe('anthropic/claude-opus-4-7')
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
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const dir = join(root, 'project')
      const prevAnthropic = process.env.ANTHROPIC_API_KEY
      const prevOpenAi = process.env.OPENAI_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      delete process.env.ANTHROPIC_API_KEY
      process.env.OPENAI_API_KEY = 'test-openai'

      const models = yield* listModels('', dir)

      expect(models.models.length).toBe(supportedCount(openai))
      expect(models.models.every((item) => item.id.startsWith('openai/'))).toBe(
        true
      )

      restoreEnv('ANTHROPIC_API_KEY', prevAnthropic)
      restoreEnv('OPENAI_API_KEY', prevOpenAi)
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('filters generated catalog models unsupported by the adapter', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const dir = join(root, 'project')
      const prevOpenAi = process.env.OPENAI_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      delete process.env.ANTHROPIC_API_KEY
      process.env.OPENAI_API_KEY = 'test-openai'

      const unsupportedModel = {
        id: '__unsupported-openai-model__',
        name: 'Unsupported OpenAI Model',
      }

      ;(openai.models as Array<MutableCatalogModel>).push(unsupportedModel)

      const models = yield* listModels('', dir)

      expect(
        models.models.some(
          (item) => item.id === `openai/${unsupportedModel.id}`
        )
      ).toBe(false)
      expect(models.models.length).toBe(supportedCount(openai))
      ;(openai.models as Array<MutableCatalogModel>).pop()
      restoreEnv('OPENAI_API_KEY', prevOpenAi)
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('accepts model selections with supported runtime variants', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const dir = join(root, 'project')
      const prevAnthropic = process.env.ANTHROPIC_API_KEY
      const prevOpenAi = process.env.OPENAI_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      delete process.env.ANTHROPIC_API_KEY
      process.env.OPENAI_API_KEY = 'test-openai'

      const models = yield* listModels('', dir)
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

      yield* ensureModel('', dir, reasoning.id, { thinkingLevel: 'low' })
      yield* ensureModel('', dir, fast.id, { mode: 'fast' })

      restoreEnv('ANTHROPIC_API_KEY', prevAnthropic)
      restoreEnv('OPENAI_API_KEY', prevOpenAi)
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )
})
