import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { ANTHROPIC_MODELS } from '../src/server/models.generated.ts'
import { listModels } from '../src/server/model-catalog.ts'

describe('ModelCatalog', () => {
  it.effect('lists generated Anthropic catalog when API key exists', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const xdg = join(root, 'xdg')
      const dir = join(root, 'project')
      const prevXdg = process.env.XDG_CONFIG_HOME
      const prevKey = process.env.ANTHROPIC_API_KEY

      yield* Effect.tryPromise(() =>
        mkdir(join(xdg, 'agents'), { recursive: true })
      )
      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))
      yield* Effect.tryPromise(() =>
        writeFile(
          join(xdg, 'agents', 'config.jsonc'),
          JSON.stringify({
            default_model: `anthropic/${ANTHROPIC_MODELS[0]?.id}`,
          })
        )
      )

      process.env.XDG_CONFIG_HOME = xdg
      process.env.ANTHROPIC_API_KEY = 'test-key'

      const models = yield* listModels(dir)

      expect(models.models.length).toBe(ANTHROPIC_MODELS.length)
      expect(models.models[0]?.id).toBe(`anthropic/${ANTHROPIC_MODELS[0]?.id}`)
      expect(models.defaultModel).toBe(`anthropic/${ANTHROPIC_MODELS[0]?.id}`)

      process.env.XDG_CONFIG_HOME = prevXdg
      process.env.ANTHROPIC_API_KEY = prevKey
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('returns no models without Anthropic credentials', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const dir = join(root, 'project')
      const prevKey = process.env.ANTHROPIC_API_KEY

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))

      delete process.env.ANTHROPIC_API_KEY

      const models = yield* listModels(dir)

      expect(models.models).toEqual([])
      expect(models.defaultModel).toBeUndefined()

      process.env.ANTHROPIC_API_KEY = prevKey
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )
})
