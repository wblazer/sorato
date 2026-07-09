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
      if (run.fiber) yield* Fiber.join(run.fiber)

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
      if (run.fiber) yield* Fiber.join(run.fiber)

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

  it.effect(
    'stops an active run through the run-scoped production stop path',
    () =>
      Effect.gen(function* () {
        const scenario = yield* makeRunScenario({
          model: [
            Scripted.textStart('text'),
            Scripted.textDelta('text', 'before stop'),
            Scripted.checkpoint('run-stop-mid-stream'),
            Scripted.textDelta('text', 'after stop'),
            Scripted.textEnd('text'),
            Scripted.finish(),
          ],
        })

        const run = yield* scenario.startRun({
          input: 'Pause then stop by run',
        })
        yield* scenario.model.waitForCheckpoint('run-stop-mid-stream')
        yield* scenario.waitForEvent(
          (event) => event._tag === 'TextDelta' && event.runId === run.runId
        )

        const response = yield* scenario.stopRun(run.runId)
        expect(response.status).toBe('stopped')

        const events = yield* scenario.eventsForRun(run.runId)
        expect(events.map((event) => event._tag)).toContain('RunEnd')
        expect(
          events.some(
            (event) =>
              event._tag === 'TextDelta' && event.delta === 'after stop'
          )
        ).toBe(false)
        expect(yield* scenario.isRunActive(run.runId)).toBe(false)
        expect((yield* scenario.getRun(run.runId)).status).toBe('interrupted')
        const latest = yield* scenario.latestNodeForRun(run.runId)
        expect(latest?.encoded.role).toBe('assistant')
        if (latest?.encoded.role === 'assistant') {
          expect('metadata' in latest.encoded).toBe(false)
        }
      }).pipe(Effect.scoped)
  )

  it.effect(
    'focuses the interrupted run on its user input before model output',
    () =>
      Effect.gen(function* () {
        const scenario = yield* makeRunScenario({
          model: [Scripted.text('should not run'), Scripted.finish()],
        })
        const run = yield* scenario.startRun({
          input: 'Stop before model output',
        })

        yield* scenario.checkpoints.waitFor(
          'afterAgentPreambleAppended',
          run.runId
        )

        const response = yield* scenario.stopRun(run.runId)
        expect(response.status).toBe('stopped')

        const events = yield* scenario.eventsForRun(run.runId)
        expect(events.map((event) => event._tag)).toContain('RunEnd')
        expect(events.map((event) => event._tag)).not.toContain('TextDelta')
        expect((yield* scenario.getRun(run.runId)).status).toBe('interrupted')

        const latest = yield* scenario.latestNodeForRun(run.runId)
        expect(latest?.encoded.role).toBe('user')
        expect(latest?.encoded.content).toBe('Stop before model output')
      }).pipe(Effect.scoped)
  )

  it.effect(
    'stops a worker run after queue shift before active registration',
    () =>
      Effect.gen(function* () {
        const scenario = yield* makeRunScenario({
          model: [Scripted.text('should not run'), Scripted.finish()],
        })
        const run = yield* scenario.enqueueRun({
          input: 'Stop while starting',
        })
        const runId = run.runId

        yield* scenario.checkpoints.waitFor(
          'afterQueueShiftBeforeActiveRegister',
          runId
        )
        expect(yield* scenario.isRunActive(runId)).toBe(false)

        const stopFiber = yield* Effect.forkDetach(scenario.stopRun(runId))
        yield* scenario.waitForEvent(
          (event) => event._tag === 'MessagesAppended'
        )
        yield* scenario.checkpoints.release(
          'afterQueueShiftBeforeActiveRegister',
          runId
        )
        const response = yield* Fiber.join(stopFiber)
        expect(response.status).toBe('stopped')

        const events = yield* scenario.eventsForRun(runId)
        expect(events.map((event) => event._tag)).toContain('RunEnd')
        expect(events.map((event) => event._tag)).not.toContain('TextDelta')
        const messages = yield* scenario.messagesForRun(runId)
        expect(messages.map((message) => message.encoded.role)).toEqual([
          'user',
        ])
        expect(messages[0]?.run?.status).toBe('interrupted')
      }).pipe(Effect.scoped)
  )

  it.effect('stops a child background run when stopping its parent run', () =>
    Effect.gen(function* () {
      const scenario = yield* makeRunScenario({
        model: [
          [
            Scripted.toolCall('compact-call', 'CompactConversation', {
              start: {
                type: 'message',
                role: 'user',
                match: 'Parent',
                include: true,
              },
              end: {
                type: 'message',
                role: 'user',
                match: 'Parent',
                include: true,
              },
            }),
            Scripted.finish('tool-calls'),
          ],
          [
            Scripted.textStart('summary'),
            Scripted.textDelta('summary', 'partial summary'),
            Scripted.checkpoint('summary-mid-stream'),
            Scripted.textDelta('summary', ' after stop'),
            Scripted.textEnd('summary'),
            Scripted.finish(),
          ],
        ],
      })
      const run = yield* scenario.startRun({ input: 'Parent run' })

      const summaryRunId = yield* scenario
        .waitForEvent(
          (event) =>
            event._tag === 'RunStart' &&
            event.parentRunId === run.runId &&
            event.visibility === 'background'
        )
        .pipe(
          Effect.map((event) => (event._tag === 'RunStart' ? event.runId : ''))
        )
      yield* scenario.model.waitForCheckpoint('summary-mid-stream')

      const response = yield* scenario.stopRun(run.runId)
      expect(response.status).toBe('stopped')

      const parentEvents = yield* scenario.eventsForRun(run.runId)
      const summaryEvents = yield* scenario.eventsForRun(summaryRunId)
      expect(parentEvents.map((event) => event._tag)).toContain('RunEnd')
      expect(summaryEvents.map((event) => event._tag)).toContain('RunEnd')
      expect(
        summaryEvents.some(
          (event) => event._tag === 'TextDelta' && event.delta === ' after stop'
        )
      ).toBe(false)
      expect((yield* scenario.getRun(run.runId)).status).toBe('interrupted')
      expect((yield* scenario.getRun(summaryRunId)).status).toBe('interrupted')
      expect(yield* scenario.isRunActive(run.runId)).toBe(false)
      expect(yield* scenario.isRunActive(summaryRunId)).toBe(false)
    }).pipe(Effect.scoped)
  )

  it.effect(
    'can pause the production worker after queue shift before active registration',
    () =>
      Effect.gen(function* () {
        const scenario = yield* makeRunScenario({
          model: [Scripted.text('worker started'), Scripted.finish()],
        })
        const run = yield* scenario.enqueueRun({
          input: 'Start through worker',
        })
        const runId = run.runId

        yield* scenario.checkpoints.waitFor(
          'afterQueueShiftBeforeActiveRegister',
          runId
        )
        expect(yield* scenario.isRunActive(runId)).toBe(false)

        yield* scenario.checkpoints.release(
          'afterQueueShiftBeforeActiveRegister',
          runId
        )
        yield* scenario.waitForRunEnd(runId)

        const latest = yield* scenario.latestNodeForRun(runId)
        expect(latest?.encoded.role).toBe('assistant')
        expect(latest?.encoded.content).toBe('worker started')
      }).pipe(Effect.scoped)
  )
})
