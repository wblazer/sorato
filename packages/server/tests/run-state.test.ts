import { Effect, Fiber } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  clearActiveFiber,
  drainQueuedRuns,
  enqueueRun,
  getFiber,
  getQueuedRunCount,
  isRunning,
  requestStop,
  registerActiveFiber,
  registerWorkerFiber,
  releaseRun,
  resetRunRegistry,
  shouldStop,
  shiftQueuedRun,
} from '../src/run-registry.ts'
import type { RunRequest } from '../src/run-registry.ts'

const runRequest = (input: string): RunRequest => ({
  runId: `run-${input}`,
  inputs: [input],
  model: 'openai/gpt-5.5',
  modelOptions: {},
  baseNodeId: null,
  afterRunId: null,
})

describe('RunRegistry', () => {
  it('marks a session running as soon as a run is enqueued', () => {
    resetRunRegistry()

    expect(enqueueRun('session-1', runRequest('hello')).status).toBe('started')
    expect(isRunning('session-1')).toBe(true)
    expect(getFiber('session-1')).toBeUndefined()
    expect(getQueuedRunCount('session-1')).toBe(1)

    releaseRun('session-1')
  })

  it('coalesces compatible queued inputs into a single run', () => {
    resetRunRegistry()

    const first = runRequest('first')
    const second = runRequest('second')

    expect(enqueueRun('session-1', first).status).toBe('started')
    expect(enqueueRun('session-1', second)).toEqual({
      status: 'queued',
      runId: first.runId,
    })
    expect(getQueuedRunCount('session-1')).toBe(1)
    expect(shiftQueuedRun('session-1')).toEqual({
      ...first,
      inputs: ['first', 'second'],
    })
    expect(getQueuedRunCount('session-1')).toBe(0)

    releaseRun('session-1')
  })

  it('releases a session when startup fails before a worker is attached', () => {
    resetRunRegistry()

    expect(enqueueRun('session-1', runRequest('hello')).status).toBe('started')
    releaseRun('session-1')

    expect(isRunning('session-1')).toBe(false)
    expect(enqueueRun('session-1', runRequest('again')).status).toBe('started')

    releaseRun('session-1')
  })

  it.effect('tracks worker and active run fibers separately', () =>
    Effect.gen(function* () {
      resetRunRegistry()

      expect(enqueueRun('session-1', runRequest('hello')).status).toBe(
        'started'
      )

      const worker = yield* Effect.forkDetach(Effect.void)
      registerWorkerFiber('session-1', worker)

      const active = yield* Effect.forkDetach(Effect.void)
      registerActiveFiber('session-1', active)

      expect(getFiber('session-1')).toBe(active)

      clearActiveFiber('session-1')
      expect(getFiber('session-1')).toBeUndefined()

      releaseRun('session-1')
      yield* Fiber.interrupt(worker)
      yield* Fiber.interrupt(active)
    })
  )

  it('marks a session as stopping and drains queued inputs', () => {
    resetRunRegistry()

    const first = runRequest('first')
    const second = runRequest('second')

    expect(enqueueRun('session-1', first).status).toBe('started')
    expect(enqueueRun('session-1', second).status).toBe('queued')
    expect(shouldStop('session-1')).toBe(false)

    requestStop('session-1')

    expect(shouldStop('session-1')).toBe(true)
    expect(drainQueuedRuns('session-1')).toEqual([
      { ...first, inputs: ['first', 'second'] },
    ])
    expect(getQueuedRunCount('session-1')).toBe(0)

    releaseRun('session-1')
  })
})
