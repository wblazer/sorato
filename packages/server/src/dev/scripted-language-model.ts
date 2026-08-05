import { Effect, Layer, Ref, Stream } from 'effect'
import {
  AiError,
  LanguageModel,
  type Prompt,
  Response,
} from 'effect/unstable/ai'

export interface ScriptedPartsStep {
  readonly type: 'parts'
  readonly parts: ReadonlyArray<Response.StreamPartEncoded>
}

export interface ScriptedDelayStep {
  readonly type: 'delay'
  readonly duration: Parameters<typeof Effect.sleep>[0]
}

export interface ScriptedFailureStep {
  readonly type: 'failure'
  readonly error: AiError.AiError
}

export type ScriptedStep =
  | Response.StreamPartEncoded
  | ScriptedPartsStep
  | ScriptedDelayStep
  | ScriptedFailureStep

export type ScriptedCall =
  | ReadonlyArray<ScriptedStep>
  | ((prompt: Prompt.Prompt) => ReadonlyArray<ScriptedStep>)

export type ScriptedPlan = ReadonlyArray<ScriptedCall>

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

const exhausted = (callIndex: number) =>
  AiError.make({
    module: 'ScriptedLanguageModel',
    method: 'streamText',
    reason: new AiError.UnknownError({
      description: `Script has no model call at index ${callIndex}.`,
    }),
  })

const partsForStep = (
  step: ScriptedStep
): Effect.Effect<
  ReadonlyArray<Response.StreamPartEncoded>,
  AiError.AiError
> => {
  switch (step.type) {
    case 'parts':
      return Effect.succeed(step.parts)
    case 'delay':
      return Effect.sleep(step.duration).pipe(Effect.as([]))
    case 'failure':
      return Effect.fail(step.error)
    default:
      return Effect.succeed([step])
  }
}

const streamForCall = (call: ScriptedCall, prompt: Prompt.Prompt) =>
  Stream.fromIterable(typeof call === 'function' ? call(prompt) : call).pipe(
    Stream.mapEffect(partsForStep),
    Stream.flattenIterable<Response.StreamPartEncoded, AiError.AiError, never>
  )

export const scriptedLanguageModelLayer = (plan: ScriptedPlan) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)

      return yield* LanguageModel.make({
        generateText: () => Effect.succeed([]),
        streamText: ({ prompt }) =>
          Ref.getAndUpdate(calls, (value) => value + 1).pipe(
            Effect.flatMap((callIndex) => {
              const call = plan[callIndex]
              return call === undefined
                ? Effect.fail(exhausted(callIndex))
                : Effect.succeed(streamForCall(call, prompt))
            }),
            Stream.unwrap
          ),
      })
    })
  )

export const Scripted = {
  textStart: (id: string): Response.StreamPartEncoded =>
    Response.makePart('text-start', { id }),
  textDelta: (id: string, delta: string): Response.StreamPartEncoded =>
    Response.makePart('text-delta', { id, delta }),
  textEnd: (id: string): Response.StreamPartEncoded =>
    Response.makePart('text-end', { id }),
  reasoningStart: (id: string): Response.StreamPartEncoded =>
    Response.makePart('reasoning-start', { id }),
  reasoningDelta: (id: string, delta: string): Response.StreamPartEncoded =>
    Response.makePart('reasoning-delta', { id, delta }),
  reasoningEnd: (id: string): Response.StreamPartEncoded =>
    Response.makePart('reasoning-end', { id }),
  text: (delta: string, id = 'text'): ScriptedPartsStep => ({
    type: 'parts',
    parts: [
      Response.makePart('text-start', { id }),
      Response.makePart('text-delta', { id, delta }),
      Response.makePart('text-end', { id }),
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
  delay: (duration: Parameters<typeof Effect.sleep>[0]): ScriptedDelayStep => ({
    type: 'delay',
    duration,
  }),
  fail: (description: string): ScriptedFailureStep => ({
    type: 'failure',
    error: AiError.make({
      module: 'ScriptedLanguageModel',
      method: 'streamText',
      reason: new AiError.UnknownError({ description }),
    }),
  }),
  finish: (reason?: Response.FinishReason): Response.StreamPartEncoded =>
    Response.makePart('finish', {
      reason: reason ?? 'stop',
      usage,
      response: undefined,
    }),
} as const
