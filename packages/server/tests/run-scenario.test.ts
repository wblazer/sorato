import { Effect, Fiber } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { makeRunScenario } from './support/run-scenario.ts'
import { Scripted } from './support/scripted-model.ts'

describe('RunScenario', () => {
  it.effect('runs a scripted model through real persistence and events', () =>
    Effect.gen(function* () {
      const scenario = yield* makeRunScenario({
        files: { 'AGENTS.md': 'Use tests.' },
        model: [
          Scripted.text('Hello from the scripted model.'),
          Scripted.finish(),
        ],
      })

      const run = yield* scenario.startRun({ input: 'Say hello' })
      yield* scenario.waitForEvent(
        (event) =>
          event._tag === 'MessagesAppended' && event.runId === run.runId
      )
      yield* Fiber.join(run.fiber)

      const events = yield* scenario.eventsForRun(run.runId)
      expect(events.map((event) => event._tag)).toContain('RunStart')
      expect(events.map((event) => event._tag)).toContain('TextDelta')
      expect(events.map((event) => event._tag)).toContain('MessagesAppended')

      const latest = yield* scenario.latestNodeForRun(run.runId)
      expect(latest?.encoded.role).toBe('assistant')
      expect(latest?.encoded.content).toBe('Hello from the scripted model.')
    }).pipe(Effect.scoped)
  )

  it.effect('can pause a model stream at a named checkpoint', () =>
    Effect.gen(function* () {
      const scenario = yield* makeRunScenario({
        model: [
          Scripted.text('before '),
          Scripted.checkpoint('mid-stream'),
          Scripted.text('after'),
          Scripted.finish(),
        ],
      })

      const run = yield* scenario.startRun({ input: 'Pause please' })
      yield* scenario.model.waitForCheckpoint('mid-stream')
      yield* scenario.waitForEvent(
        (event) => event._tag === 'TextDelta' && event.runId === run.runId
      )

      const beforeRelease = yield* scenario.eventsForRun(run.runId)
      expect(
        beforeRelease.some(
          (event) => event._tag === 'TextDelta' && event.delta === 'before '
        )
      ).toBe(true)
      expect(
        beforeRelease.some(
          (event) => event._tag === 'TextDelta' && event.delta === 'after'
        )
      ).toBe(false)

      yield* scenario.model.releaseCheckpoint('mid-stream')
      yield* Fiber.join(run.fiber)

      const latest = yield* scenario.latestNodeForRun(run.runId)
      expect(String(latest?.encoded.content)).toContain('before')
    }).pipe(Effect.scoped)
  )

  it.effect('stops an active run through the production stop path', () =>
    Effect.gen(function* () {
      const scenario = yield* makeRunScenario({
        model: [
          Scripted.textStart('text'),
          Scripted.textDelta('text', 'before stop'),
          Scripted.checkpoint('mid-stream'),
          Scripted.textDelta('text', 'after stop'),
          Scripted.textEnd('text'),
          Scripted.finish(),
        ],
      })

      const run = yield* scenario.startRun({ input: 'Pause then stop' })
      yield* scenario.model.waitForCheckpoint('mid-stream')
      yield* scenario.waitForEvent(
        (event) => event._tag === 'TextDelta' && event.runId === run.runId
      )

      const response = yield* scenario.stopSession()
      expect(response.status).toBe('stopped')

      const events = yield* scenario.eventsForRun(run.runId)
      expect(events.map((event) => event._tag)).toContain('RunEnd')
      expect(
        events.some(
          (event) => event._tag === 'TextDelta' && event.delta === 'after stop'
        )
      ).toBe(false)
      expect(yield* scenario.isRunActive(run.runId)).toBe(false)
    }).pipe(Effect.scoped)
  )
})
