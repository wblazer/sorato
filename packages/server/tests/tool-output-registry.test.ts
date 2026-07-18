import { Deferred, Effect, Fiber, Layer, Ref, Schema, Stream } from 'effect'
import {
  LanguageModel,
  Prompt,
  Response,
  Tool,
  Toolkit,
} from 'effect/unstable/ai'
import { describe, expect, it } from '@effect/vitest'
import { run, ToolOutputRegistry } from '@sorato/core'

const RESULT = 'shared result'

const Display = Tool.make('Display', {
  parameters: Schema.Struct({ run: Schema.Literals(['a', 'b']) }),
  success: Schema.String,
  dependencies: [ToolOutputRegistry],
})

const DisplayToolkit = Toolkit.make(Display)

const finish = Response.makePart('finish', {
  reason: 'stop',
  usage: new Response.Usage({
    inputTokens: {
      uncached: undefined,
      total: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 1,
      text: undefined,
      reasoning: undefined,
    },
  }),
  response: undefined,
})

const modelLayer = (runName: 'a' | 'b') =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      return yield* LanguageModel.make({
        generateText: () => Effect.succeed([]),
        streamText: () =>
          Ref.getAndUpdate(calls, (call) => call + 1).pipe(
            Effect.map((call) =>
              Stream.fromIterable(
                call === 0
                  ? [
                      Response.makePart('tool-call', {
                        id: `call-${runName}`,
                        name: 'Display',
                        params: { run: runName },
                        providerExecuted: false,
                      }),
                      finish,
                    ]
                  : [finish]
              )
            ),
            Stream.unwrap
          ),
      })
    })
  )

describe('ToolOutputRegistry', () => {
  it.effect('isolates display records between concurrent harness runs', () =>
    Effect.gen(function* () {
      const aPushed = yield* Deferred.make<void>()
      const bPushed = yield* Deferred.make<void>()
      const releaseA = yield* Deferred.make<void>()

      const handlers = DisplayToolkit.toLayer({
        Display: ({ run: runName }) =>
          Effect.gen(function* () {
            const registry = yield* ToolOutputRegistry

            if (runName === 'b') yield* Deferred.await(aPushed)

            registry.push({
              toolName: 'Display',
              result: RESULT,
              bodyDisplay: {
                type: 'inline-diff',
                fileName: runName,
                patch: '',
                summary: { additions: 1, deletions: 0 },
              },
            })

            if (runName === 'a') {
              yield* Deferred.succeed(aPushed, undefined)
              yield* Deferred.await(releaseA)
            } else {
              yield* Deferred.succeed(bPushed, undefined)
            }

            return RESULT
          }),
      })

      const runHarness = (runName: 'a' | 'b') =>
        run(Prompt.make(`run ${runName}`), { toolkit: DisplayToolkit }).pipe(
          Effect.provide(handlers),
          Effect.provide(modelLayer(runName))
        )

      const runA = yield* runHarness('a').pipe(Effect.forkChild)
      yield* Deferred.await(aPushed)

      const runB = yield* runHarness('b').pipe(Effect.forkChild)
      yield* Deferred.await(bPushed)
      const resultB = yield* Fiber.join(runB)

      yield* Deferred.succeed(releaseA, undefined)
      const resultA = yield* Fiber.join(runA)

      expect(
        resultA.toolResultBodyDisplays.get('call-a')?.bodyDisplay?.fileName
      ).toBe('a')
      expect(
        resultB.toolResultBodyDisplays.get('call-b')?.bodyDisplay?.fileName
      ).toBe('b')
    })
  )
})
