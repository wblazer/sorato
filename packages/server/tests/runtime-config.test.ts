import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  RuntimeConfigLive,
  RuntimeConfigService,
} from '../src/runtime-config.ts'

const loadRuntimeConfig = (dir: string) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* RuntimeConfigService
    return yield* runtimeConfig.get(dir)
  }).pipe(Effect.provide(RuntimeConfigLive))

describe('RuntimeConfig', () => {
  it.effect('merges global and local config with local override', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'sorato-'))
      )
      const xdg = join(root, 'xdg')
      const dir = join(root, 'project')
      const prev = process.env.XDG_CONFIG_HOME

      yield* Effect.tryPromise(() =>
        Promise.all([
          mkdir(join(xdg, 'sorato'), { recursive: true }),
          mkdir(join(dir, '.sorato'), { recursive: true }),
        ])
      )

      yield* Effect.tryPromise(() =>
        writeFile(
          join(xdg, 'sorato', 'config.json'),
          JSON.stringify({
            roles: {
              summary: { model: 'openai/gpt-5-nano' },
            },
          })
        )
      )

      yield* Effect.tryPromise(() =>
        writeFile(
          join(xdg, 'sorato', 'config.jsonc'),
          `{
            // global default
            "default_model": "anthropic/claude-haiku-4-5",
            "instructions": "global instructions",
            "environment_command": "global-env",
            "roles": {
              "summary": { "instructions": "global summary instructions" },
              "title": { "instructions": "short titles" }
            }
          }`
        )
      )

      yield* Effect.tryPromise(() =>
        writeFile(
          join(dir, '.sorato', 'config.json'),
          JSON.stringify({
            default_model: 'anthropic/claude-sonnet-4-20250514',
            instructions: 'project instructions',
            environment_command: 'project-env',
            roles: {
              summary: { instructions: 'preserve decisions' },
              title: { model: 'openai/gpt-5.4-mini' },
            },
          })
        )
      )

      process.env.XDG_CONFIG_HOME = xdg

      const cfg = yield* loadRuntimeConfig(dir)

      expect(cfg.default_model).toBe('anthropic/claude-sonnet-4-20250514')
      expect(cfg.environment_command).toBe('project-env')
      expect(cfg.instructions).toEqual([
        'global instructions',
        'project instructions',
      ])
      expect(cfg.roles).toEqual({
        summary: {
          model: 'openai/gpt-5-nano',
          instructions: ['global summary instructions', 'preserve decisions'],
        },
        title: {
          model: 'openai/gpt-5.4-mini',
          instructions: ['short titles'],
        },
      })

      process.env.XDG_CONFIG_HOME = prev
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )

  it.effect('returns empty config when files are absent', () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), 'sorato-'))
      )
      const dir = join(root, 'project')
      const prev = process.env.XDG_CONFIG_HOME

      yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))
      process.env.XDG_CONFIG_HOME = join(root, 'xdg')

      const cfg = yield* loadRuntimeConfig(dir)

      expect(cfg).toEqual({
        default_model: null,
        environment_command: null,
        instructions: [],
        roles: {
          summary: { model: null, instructions: [] },
          title: { model: null, instructions: [] },
        },
      })

      process.env.XDG_CONFIG_HOME = prev
      yield* Effect.tryPromise(() => rm(root, { recursive: true, force: true }))
    })
  )
})
