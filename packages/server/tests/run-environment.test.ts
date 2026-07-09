import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { parseEnvironmentOutput } from '../src/run-environment.ts'

describe('run environment', () => {
  it.effect('parses direnv json null entries as removals', () =>
    Effect.gen(function* () {
      const parsed = yield* parseEnvironmentOutput(
        JSON.stringify({ FOO: 'bar', REMOVED: null })
      )

      expect(parsed).toEqual({
        format: 'json',
        env: {
          FOO: 'bar',
          REMOVED: undefined,
        },
      })
    })
  )

  it.effect('accepts empty output as an empty environment diff', () =>
    Effect.gen(function* () {
      const parsed = yield* parseEnvironmentOutput('\n')

      expect(parsed).toEqual({
        format: 'empty',
        env: {},
      })
    })
  )
})
