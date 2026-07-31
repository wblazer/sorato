import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Stream,
  SubscriptionRef,
} from 'effect'
import { LanguageModel, Response } from 'effect/unstable/ai'
import {
  DevScenario,
  DevScenarioId,
  DevScenariosStatus,
  DevScenariosUnavailable,
} from '@sorato/api'

export const MOCK_MODEL_ID = 'mock/streaming-demo'

export const MockAgentScenario = DevScenarioId
export type MockAgentScenario = typeof MockAgentScenario.Type

export interface MockAgentConfigApi {
  readonly enabled: boolean
  readonly get: () => Effect.Effect<Option.Option<MockAgentScenario>>
  readonly set: (
    scenario: Option.Option<MockAgentScenario>
  ) => Effect.Effect<void, DevScenariosUnavailable>
  readonly status: () => Effect.Effect<
    DevScenariosStatus,
    DevScenariosUnavailable
  >
}

export class MockAgentConfig extends Context.Service<
  MockAgentConfig,
  MockAgentConfigApi
>()('@sorato/server/MockAgentConfig') {}

const scenarios = [
  DevScenario.make({
    id: 'streaming',
    label: 'Streaming response',
    description: 'Streams deterministic reasoning and answer chunks.',
    tags: ['streaming', 'reasoning'],
    capabilities: ['text', 'reasoning'],
  }),
  DevScenario.make({
    id: 'tool-use',
    label: 'Tool use',
    description: 'Calls the real Read tool, then responds on the next turn.',
    tags: ['tools', 'multi-turn'],
    capabilities: ['text', 'tool-call'],
  }),
  DevScenario.make({
    id: 'interruptible',
    label: 'Interruptible stream',
    description: 'A long paced stream for exercising run cancellation.',
    tags: ['streaming', 'long-running', 'cancellation'],
    capabilities: ['text'],
  }),
  DevScenario.make({
    id: 'branching',
    label: 'Branch marker',
    description:
      'Produces a conspicuous deterministic answer for branch testing.',
    tags: ['branching', 'deterministic'],
    capabilities: ['text'],
  }),
]

const unavailable = () =>
  new DevScenariosUnavailable({
    code: 'dev.scenarios_unavailable',
    message: 'Development scenarios are not enabled on this server.',
    retryable: false,
  })

const makeConfig = (
  enabled: boolean,
  initial: Option.Option<MockAgentScenario>
) =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.make(initial)
    const get = Effect.fn('MockAgentConfig.get')(function* () {
      return yield* SubscriptionRef.get(current)
    })
    const set = Effect.fn('MockAgentConfig.set')(function* (
      scenario: Option.Option<MockAgentScenario>
    ) {
      if (!enabled) return yield* unavailable()
      yield* SubscriptionRef.set(current, scenario)
    })
    const status = Effect.fn('MockAgentConfig.status')(function* () {
      if (!enabled) return yield* unavailable()
      const active = yield* get()
      return DevScenariosStatus.make({
        enabled: true,
        activeScenario: Option.getOrNull(active),
        scenarios,
      })
    })
    return MockAgentConfig.of({ enabled, get, set, status })
  })

export const MockAgentDisabled = Layer.effect(
  MockAgentConfig,
  makeConfig(false, Option.none())
)

export const MockAgentConfigLive = Layer.effect(
  MockAgentConfig,
  Effect.gen(function* () {
    const enabled = yield* Config.boolean('SORATO_DEV_SCENARIOS').pipe(
      Config.withDefault(false)
    )
    const startupScenario = yield* Config.schema(
      MockAgentScenario,
      'SORATO_MOCK_AGENT_SCENARIO'
    ).pipe(Config.option)
    return yield* makeConfig(enabled, enabled ? startupScenario : Option.none())
  })
)

export const isMockModel = (
  scenario: Option.Option<MockAgentScenario>,
  id: string
) => id === MOCK_MODEL_ID && Option.isSome(scenario)

const usage = new Response.Usage({
  inputTokens: {
    uncached: undefined,
    total: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
})

const finish = (reason: Response.FinishReason = 'stop') =>
  Response.makePart('finish', { reason, usage, response: undefined })

const streamingParts = [
  Response.makePart('reasoning-start', { id: 'reasoning' }),
  Response.makePart('reasoning-delta', {
    id: 'reasoning',
    delta: 'Inspecting the deterministic mock request. ',
  }),
  Response.makePart('reasoning-delta', {
    id: 'reasoning',
    delta: 'Preparing a streamed response.',
  }),
  Response.makePart('reasoning-end', { id: 'reasoning' }),
  Response.makePart('text-start', { id: 'text' }),
  Response.makePart('text-delta', { id: 'text', delta: 'Hello from the ' }),
  Response.makePart('text-delta', { id: 'text', delta: 'Sorato mock agent. ' }),
  Response.makePart('text-delta', {
    id: 'text',
    delta: 'This response used the normal streaming pipeline.',
  }),
  Response.makePart('text-end', { id: 'text' }),
  finish(),
] satisfies ReadonlyArray<Response.StreamPartEncoded>

const toolCallParts = [
  Response.makePart('tool-call', {
    id: 'mock-read-agents',
    name: 'Read',
    params: { path: 'AGENTS.md' },
    providerExecuted: false,
  }),
  finish('tool-calls'),
] satisfies ReadonlyArray<Response.StreamPartEncoded>

const toolAnswerParts = [
  Response.makePart('text-start', { id: 'tool-answer' }),
  Response.makePart('text-delta', {
    id: 'tool-answer',
    delta: 'I read AGENTS.md through the real Read tool. ',
  }),
  Response.makePart('text-delta', {
    id: 'tool-answer',
    delta: 'Its result was returned to this second deterministic model call.',
  }),
  Response.makePart('text-end', { id: 'tool-answer' }),
  finish(),
] satisfies ReadonlyArray<Response.StreamPartEncoded>

const branchingParts = [
  Response.makePart('text-start', { id: 'branch' }),
  Response.makePart('text-delta', {
    id: 'branch',
    delta: '◆ BRANCHING SCENARIO ◆ This is a deterministic branch response.',
  }),
  Response.makePart('text-end', { id: 'branch' }),
  finish(),
] satisfies ReadonlyArray<Response.StreamPartEncoded>

export const MOCK_SUMMARY =
  'The selected conversation range was compacted by the deterministic Sorato mock summarizer. It preserves the prior goals, decisions, relevant tool results, and unresolved work for continuation.'

const summaryParts = [
  Response.makePart('text-start', { id: 'summary' }),
  Response.makePart('text-delta', {
    id: 'summary',
    delta: MOCK_SUMMARY,
  }),
  Response.makePart('text-end', { id: 'summary' }),
  finish(),
] satisfies ReadonlyArray<Response.StreamPartEncoded>

const interruptibleParts = [
  Response.makePart('text-start', { id: 'interruptible' }),
  ...Array.from({ length: 100 }, (_, index) =>
    Response.makePart('text-delta', {
      id: 'interruptible',
      delta: `paced-chunk-${index + 1} `,
    })
  ),
  Response.makePart('text-end', { id: 'interruptible' }),
  finish(),
] satisfies ReadonlyArray<Response.StreamPartEncoded>

export const mockLanguageModelLayer = (
  scenario: MockAgentScenario,
  runKind: 'agent' | 'summary' = 'agent'
) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      return yield* LanguageModel.make({
        generateText: () => Effect.succeed([]),
        streamText: () =>
          Ref.getAndUpdate(calls, (value) => value + 1).pipe(
            Effect.map((call): ReadonlyArray<Response.StreamPartEncoded> => {
              if (runKind === 'summary') return summaryParts
              if (scenario === 'tool-use') {
                return call === 0 ? toolCallParts : toolAnswerParts
              }
              if (scenario === 'interruptible') return interruptibleParts
              if (scenario === 'branching') return branchingParts
              return streamingParts
            }),
            Effect.map((parts) =>
              Stream.fromIterable(parts).pipe(
                Stream.schedule(Schedule.spaced('60 millis'))
              )
            ),
            Stream.unwrap
          ),
      })
    })
  )
