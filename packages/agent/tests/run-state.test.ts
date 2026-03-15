import { Effect, Fiber } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  claimRun,
  getFiber,
  isRunning,
  registerFiber,
  releaseRun,
  resetRunState,
} from '../src/server/run-state.ts'

describe('RunState', () => {
  it('marks a session running as soon as it is claimed', () => {
    resetRunState()

    expect(claimRun('session-1')).toBe(true)
    expect(isRunning('session-1')).toBe(true)
    expect(getFiber('session-1')).toBeUndefined()

    releaseRun('session-1')
  })

  it('rejects a second claim for the same session', () => {
    resetRunState()

    expect(claimRun('session-1')).toBe(true)
    expect(claimRun('session-1')).toBe(false)

    releaseRun('session-1')
  })

  it('releases a claim when startup fails before a fiber is attached', () => {
    resetRunState()

    expect(claimRun('session-1')).toBe(true)
    releaseRun('session-1')

    expect(isRunning('session-1')).toBe(false)
    expect(claimRun('session-1')).toBe(true)

    releaseRun('session-1')
  })

  it.effect('attaches a fiber to an existing claim', () =>
    Effect.gen(function* () {
      resetRunState()

      expect(claimRun('session-1')).toBe(true)

      const fiber = yield* Effect.forkDaemon(Effect.void)
      registerFiber('session-1', fiber)

      expect(getFiber('session-1')).toBe(fiber)

      releaseRun('session-1')
      yield* Fiber.interrupt(fiber)
    })
  )
})
