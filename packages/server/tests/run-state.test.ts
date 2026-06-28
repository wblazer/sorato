import { Effect, Fiber } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  clearActiveFiber,
  drainQueuedRuns,
  enqueueRun,
  getFibers,
  getQueuedRunCount,
  isRunning,
  requestStop,
  registerActiveFiber,
  registerWorkerFiber,
  releaseRunQueue,
  resetRunRegistry,
  shouldStop,
  shiftQueuedRun,
} from '../src/run-registry.ts'
import type { RunRequest } from '../src/run-registry.ts'

const runRequest = (input: string): RunRequest => ({
  runId: `run-${input}`,
  inputs: [{ text: input, attachments: [] }],
  model: 'openai/gpt-5.5',
  modelOptions: {},
  baseNodeId: null,
  afterRunId: null,
})

describe('RunRegistry', () => {
  it('marks a session running as soon as a run is enqueued', () => {
    resetRunRegistry()

    const run = enqueueRun('session-1', runRequest('hello'))
    expect(run.status).toBe('started')
    expect(isRunning('session-1')).toBe(true)
    expect(getFibers('session-1')).toEqual([])
    expect(getQueuedRunCount('session-1')).toBe(1)

    releaseRunQueue(run.queueId)
  })

  it('coalesces compatible queued inputs into a single run', () => {
    resetRunRegistry()

    const first = runRequest('first')
    const second = runRequest('second')

    const run = enqueueRun('session-1', first)
    expect(run.status).toBe('started')
    expect(enqueueRun('session-1', second, first.runId)).toMatchObject({
      status: 'queued',
      runId: first.runId,
    })
    expect(getQueuedRunCount('session-1')).toBe(1)
    expect(shiftQueuedRun(run.queueId)).toEqual({
      ...first,
      inputs: [
        { text: 'first', attachments: [] },
        { text: 'second', attachments: [] },
      ],
    })
    expect(getQueuedRunCount('session-1')).toBe(0)

    releaseRunQueue(run.queueId)
  })

  it('releases a session when startup fails before a worker is attached', () => {
    resetRunRegistry()

    const first = enqueueRun('session-1', runRequest('hello'))
    expect(first.status).toBe('started')
    releaseRunQueue(first.queueId)

    expect(isRunning('session-1')).toBe(false)
    const second = enqueueRun('session-1', runRequest('again'))
    expect(second.status).toBe('started')

    releaseRunQueue(second.queueId)
  })

  it.effect('tracks worker and active run fibers separately', () =>
    Effect.gen(function* () {
      resetRunRegistry()

      const run = enqueueRun('session-1', runRequest('hello'))
      expect(run.status).toBe('started')

      const worker = yield* Effect.forkDetach(Effect.void)
      registerWorkerFiber(run.queueId, worker)

      const active = yield* Effect.forkDetach(Effect.void)
      registerActiveFiber(run.queueId, run.runId, null, active)

      expect(getFibers('session-1')).toEqual([active])

      clearActiveFiber(run.queueId)
      expect(getFibers('session-1')).toEqual([])

      releaseRunQueue(run.queueId)
      yield* Fiber.interrupt(worker)
      yield* Fiber.interrupt(active)
    })
  )

  it('marks a session as stopping and drains queued inputs', () => {
    resetRunRegistry()

    const first = runRequest('first')
    const second = runRequest('second')

    const run = enqueueRun('session-1', first)
    expect(run.status).toBe('started')
    expect(enqueueRun('session-1', second, first.runId).status).toBe('queued')
    expect(shouldStop(run.queueId)).toBe(false)

    requestStop('session-1')

    expect(shouldStop(run.queueId)).toBe(true)
    expect(drainQueuedRuns('session-1')).toEqual([
      {
        ...first,
        inputs: [
          { text: 'first', attachments: [] },
          { text: 'second', attachments: [] },
        ],
      },
    ])
    expect(getQueuedRunCount('session-1')).toBe(0)

    releaseRunQueue(run.queueId)
  })
})
