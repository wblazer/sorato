import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { MODEL_PROVIDERS } from '../src/server/models.generated.ts'
import { listModels } from '../src/server/model-catalog.ts'

const anthropic = MODEL_PROVIDERS.find(
  (provider) => provider.id === 'anthropic'
)!
const openai = MODEL_PROVIDERS.find((provider) => provider.id === 'openai')!

describe('ModelCatalog', () => {
  it.effect('lists generated models for all available runtime providers', () =>
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

      const models = yield* listModels(dir)

      expect(models.models.length).toBe(
        anthropic.models.length + openai.models.length
      )
      expect(models.models[0]?.id).toBe(`anthropic/${anthropic.models[0]?.id}`)
      expect(models.models.at(-1)?.id).toBe(
        `openai/${openai.models.at(-1)?.id}`
      )
      expect(models.defaultModel).toBe(`openai/${openai.models[0]?.id}`)

      process.env.XDG_CONFIG_HOME = prevXdg
      process.env.ANTHROPIC_API_KEY = prevAnthropic
      process.env.OPENAI_API_KEY = prevOpenAi
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
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

      const models = yield* listModels(dir)

      expect(models.models.length).toBe(openai.models.length)
      expect(models.models.every((item) => item.id.startsWith('openai/'))).toBe(
        true
      )

      process.env.ANTHROPIC_API_KEY = prevAnthropic
      process.env.OPENAI_API_KEY = prevOpenAi
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )
})
