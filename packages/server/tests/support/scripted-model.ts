import { Context, Deferred, Effect, Layer, Ref, Stream } from 'effect'
import { LanguageModel, Response } from 'effect/unstable/ai'
import { ModelLayerResolver } from '../../src/model-catalog.ts'

export interface ScriptedModelCheckpointStep {
  readonly type: 'checkpoint'
  readonly name: string
}

export interface ScriptedModelPartsStep {
  readonly type: 'parts'
  readonly parts: ReadonlyArray<Response.StreamPartEncoded>
}

export type ScriptedModelStep =
  | Response.StreamPartEncoded
  | ScriptedModelCheckpointStep
  | ScriptedModelPartsStep

export interface ScriptedModelCheckpoint {
  readonly name: string
  readonly callIndex: number
}

interface Gate {
  readonly reached: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}

export interface ScriptedModelControllerApi {
  readonly waitForCheckpoint: (name: string) => Effect.Effect<void>
  readonly releaseCheckpoint: (name: string) => Effect.Effect<void>
  readonly checkpoints: Effect.Effect<ReadonlyArray<ScriptedModelCheckpoint>>
  readonly calls: Effect.Effect<number>
}

export class ScriptedModelController extends Context.Service<
  ScriptedModelController,
  ScriptedModelControllerApi
>()('@sorato/server/test/ScriptedModelController') {}

class ScriptedModelEnvironment extends Context.Service<
  ScriptedModelEnvironment,
  {
    readonly controller: ScriptedModelControllerApi
    readonly languageModelLayer: Layer.Layer<LanguageModel.LanguageModel>
  }
>()('@sorato/server/test/ScriptedModelEnvironment') {}

const usage = new Response.Usage({
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
})

const getGate = (gates: Map<string, Gate>, name: string): Effect.Effect<Gate> =>
  Effect.gen(function* () {
    const existing = gates.get(name)
    if (existing) return existing

    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const gate = { reached, release }
    gates.set(name, gate)
    return gate
  })

const partsForStep = (
  step: ScriptedModelStep,
  callIndex: number,
  gates: Map<string, Gate>,
  checkpointsRef: Ref.Ref<ReadonlyArray<ScriptedModelCheckpoint>>
): Effect.Effect<ReadonlyArray<Response.StreamPartEncoded>> => {
  switch (step.type) {
    case 'checkpoint':
      return getGate(gates, step.name).pipe(
        Effect.tap(() =>
          Ref.update(checkpointsRef, (items) => [
            ...items,
            { name: step.name, callIndex },
          ])
        ),
        Effect.tap((gate) => Deferred.succeed(gate.reached, undefined)),
        Effect.flatMap((gate) => Deferred.await(gate.release)),
        Effect.map(() => [])
      )
    case 'parts':
      return Effect.succeed(step.parts)
    default:
      return Effect.succeed([step])
  }
}

const streamForSteps = (
  steps: ReadonlyArray<ScriptedModelStep>,
  callIndex: number,
  gates: Map<string, Gate>,
  checkpointsRef: Ref.Ref<ReadonlyArray<ScriptedModelCheckpoint>>
) =>
  Stream.fromIterable(steps).pipe(
    Stream.mapEffect((step) =>
      partsForStep(step, callIndex, gates, checkpointsRef)
    ),
    Stream.flattenIterable<Response.StreamPartEncoded, never, never>
  )

export const scriptedModelLayer = (
  script:
    | ReadonlyArray<ScriptedModelStep>
    | ReadonlyArray<ReadonlyArray<ScriptedModelStep>>
) => {
  const scripts = Array.isArray(script[0])
    ? (script as ReadonlyArray<ReadonlyArray<ScriptedModelStep>>)
    : [script as ReadonlyArray<ScriptedModelStep>]

  const streamForCall = (
    callsRef: Ref.Ref<number>,
    scripts: ReadonlyArray<ReadonlyArray<ScriptedModelStep>>,
    gates: Map<string, Gate>,
    checkpointsRef: Ref.Ref<ReadonlyArray<ScriptedModelCheckpoint>>
  ) =>
    Ref.getAndUpdate(callsRef, (value) => value + 1).pipe(
      Effect.map((callIndex) => {
        const steps = scripts[callIndex] ?? scripts[scripts.length - 1] ?? []
        return streamForSteps(steps, callIndex, gates, checkpointsRef)
      }),
      Stream.unwrap
    )

  const environmentLayer = Layer.effect(
    ScriptedModelEnvironment,
    Effect.gen(function* () {
      const gates = new Map<string, Gate>()
      const callsRef = yield* Ref.make(0)
      const checkpointsRef = yield* Ref.make<
        ReadonlyArray<ScriptedModelCheckpoint>
      >([])

      const languageModelLayer = Layer.effect(
        LanguageModel.LanguageModel,
        LanguageModel.make({
          generateText: () => Effect.succeed([]),
          streamText: () =>
            streamForCall(callsRef, scripts, gates, checkpointsRef),
        })
      )

      const controller = ScriptedModelController.of({
        waitForCheckpoint: (name) =>
          getGate(gates, name).pipe(
            Effect.flatMap((gate) => Deferred.await(gate.reached))
          ),
        releaseCheckpoint: (name) =>
          getGate(gates, name).pipe(
            Effect.flatMap((gate) => Deferred.succeed(gate.release, undefined)),
            Effect.asVoid
          ),
        checkpoints: Ref.get(checkpointsRef),
        calls: Ref.get(callsRef),
      })

      return ScriptedModelEnvironment.of({ controller, languageModelLayer })
    })
  )

  const controllerLayer = Layer.effect(
    ScriptedModelController,
    Effect.map(
      ScriptedModelEnvironment,
      (environment) => environment.controller
    )
  )

  const resolverLayer = Layer.effect(
    ModelLayerResolver,
    Effect.map(ScriptedModelEnvironment, (environment) => ({
      resolve: () => Effect.succeed(environment.languageModelLayer),
    }))
  )

  return Layer.merge(controllerLayer, resolverLayer).pipe(
    Layer.provide(environmentLayer)
  )
}

export const Scripted = {
  textStart: (id: string): Response.StreamPartEncoded =>
    Response.makePart('text-start', { id }),
  textDelta: (id: string, delta: string): Response.StreamPartEncoded =>
    Response.makePart('text-delta', { id, delta }),
  textEnd: (id: string): Response.StreamPartEncoded =>
    Response.makePart('text-end', { id }),
  text: (delta: string, id = 'text'): ScriptedModelPartsStep => ({
    type: 'parts',
    parts: [
      Response.makePart('text-start', { id }),
      Response.makePart('text-delta', { id, delta }),
      Response.makePart('text-end', { id }),
    ],
  }),
  reasoningStart: (id: string): Response.StreamPartEncoded =>
    Response.makePart('reasoning-start', { id }),
  reasoningDelta: (id: string, delta: string): Response.StreamPartEncoded =>
    Response.makePart('reasoning-delta', { id, delta }),
  reasoningEnd: (id: string): Response.StreamPartEncoded =>
    Response.makePart('reasoning-end', { id }),
  reasoning: (delta: string, id = 'reasoning'): ScriptedModelPartsStep => ({
    type: 'parts',
    parts: [
      Response.makePart('reasoning-start', { id }),
      Response.makePart('reasoning-delta', { id, delta }),
      Response.makePart('reasoning-end', { id }),
    ],
  }),
  toolCall: (
    id: string,
    name: string,
    params: unknown
  ): Response.StreamPartEncoded =>
    Response.makePart('tool-call', {
      id,
      name,
      params,
      providerExecuted: false,
    }),
  checkpoint: (name: string): ScriptedModelCheckpointStep => ({
    type: 'checkpoint',
    name,
  }),
  finish: (reason?: Response.FinishReason): Response.StreamPartEncoded =>
    Response.makePart('finish', {
      reason: reason ?? 'stop',
      usage,
      response: undefined,
    }),
} as const
