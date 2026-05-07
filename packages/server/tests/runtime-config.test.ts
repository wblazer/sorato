import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { RuntimeConfigLive, RuntimeConfigService } from '../src/runtime-config.ts'

const loadRuntimeConfig = (dir: string) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* RuntimeConfigService
    return yield* runtimeConfig.get(dir)
  }).pipe(Effect.provide(RuntimeConfigLive))

describe('RuntimeConfig', () => {
  it.effect('merges global and local config with local override', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const xdg = join(root, 'xdg')
      const dir = join(root, 'project')
      const prev = process.env.XDG_CONFIG_HOME

      yield* Effect.tryPromise(() =>
        Promise.all([
          mkdir(join(xdg, 'agents'), { recursive: true }),
          mkdir(join(dir, '.agents'), { recursive: true }),
        ])
      )

      yield* Effect.tryPromise(() =>
        writeFile(
          join(xdg, 'agents', 'config.jsonc'),
          `{
            // global default
            "default_model": "anthropic/claude-haiku-4-5",
          }`
        )
      )

      yield* Effect.tryPromise(() =>
        writeFile(
          join(dir, '.agents', 'config.json'),
          JSON.stringify({
            default_model: 'anthropic/claude-sonnet-4-20250514',
          })
        )
      )

      process.env.XDG_CONFIG_HOME = xdg

      const cfg = yield* loadRuntimeConfig(dir)

      expect(cfg.default_model).toBe('anthropic/claude-sonnet-4-20250514')

      process.env.XDG_CONFIG_HOME = prev
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('returns empty config when files are absent', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'agents-'))
      )
      const dir = join(root, 'project')
      const prev = process.env.XDG_CONFIG_HOME

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))
      process.env.XDG_CONFIG_HOME = join(root, 'xdg')

      const cfg = yield* loadRuntimeConfig(dir)

      expect(cfg).toEqual({ default_model: null, title_model: null })

      process.env.XDG_CONFIG_HOME = prev
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )
})
