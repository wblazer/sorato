import { ConfigProvider, Effect, Fiber, Layer, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { LanguageModel } from 'effect/unstable/ai'
import { describe, expect, it } from '@effect/vitest'
import {
  listModels,
  ModelLayerResolver,
  ModelLayerResolverLive,
} from '../src/model-catalog.ts'
import {
  MOCK_MODEL_ID,
  MockAgentConfig,
  MockAgentConfigLive,
  MockAgentDisabled,
} from '../src/mock-agent.ts'
import { ProviderAuthStore } from '../src/provider-auth.ts'
import { RuntimeConfigService } from '../src/runtime-config.ts'

const runtimeConfig = Layer.succeed(RuntimeConfigService, {
  get: () =>
    Effect.succeed({
      default_model: null,
      title_model: null,
      environment_command: null,
    }),
})

const noCredentials = Layer.succeed(ProviderAuthStore, {
  getAuth: () => Effect.succeed(undefined),
  setApiKey: () => Effect.void,
  setOauth: () => Effect.void,
  providerApiKey: () => Effect.succeed(undefined),
  hasProviderAuth: () => Effect.succeed(false),
})

const enabled = (
  scenario?: 'streaming' | 'tool-use' | 'interruptible' | 'branching'
) =>
  MockAgentConfigLive.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          SORATO_DEV_SCENARIOS: true,
          ...(scenario === undefined
            ? {}
            : { SORATO_MOCK_AGENT_SCENARIO: scenario }),
        })
      )
    )
  )

describe('MockAgent', () => {
  it.effect('is disabled by default and leaves no mock model available', () =>
    Effect.gen(function* () {
      const config = yield* MockAgentConfig
      expect(Option.isNone(yield* config.get())).toBe(true)
      const failure = yield* config.status().pipe(Effect.flip)
      expect(failure._tag).toBe('DevScenariosUnavailable')
    }).pipe(Effect.provide(MockAgentDisabled))
  )

  it.effect('lists and dynamically activates and deactivates scenarios', () =>
    Effect.gen(function* () {
      const config = yield* MockAgentConfig
      const initial = yield* config.status()
      expect(initial.activeScenario).toBeNull()
      expect(initial.scenarios.map(({ id }) => id)).toContain('interruptible')

      yield* config.set(Option.some('branching'))
      expect((yield* config.status()).activeScenario).toBe('branching')
      yield* config.set(Option.none())
      expect((yield* config.status()).activeScenario).toBeNull()
    }).pipe(Effect.provide(enabled()))
  )

  it.effect('changes the credential-free model catalog dynamically', () =>
    Effect.gen(function* () {
      const config = yield* MockAgentConfig
      yield* config.set(Option.some('streaming'))
      const active = yield* listModels('/tmp/mock-project')
      expect(active.models.map(({ id }) => id)).toContain(MOCK_MODEL_ID)

      yield* config.set(Option.none())
      const unavailable = yield* listModels('/tmp/mock-project').pipe(
        Effect.flip
      )
      expect(unavailable._tag).toBe('ProviderNotConfigured')
    }).pipe(
      Effect.provide(Layer.mergeAll(runtimeConfig, noCredentials, enabled()))
    )
  )

  it.effect(
    'lists the mock model without provider credentials when enabled',
    () =>
      Effect.gen(function* () {
        const models = yield* listModels('/tmp/mock-project')
        expect(models.models.map((model) => model.id)).toEqual([MOCK_MODEL_ID])
        expect(models.models[0]?.provider).toContain('deterministic mock')
      }).pipe(
        Effect.provide(
          Layer.mergeAll(runtimeConfig, noCredentials, enabled('streaming'))
        )
      )
  )

  it.effect('resolves a production mock LanguageModel stream', () =>
    Effect.gen(function* () {
      const resolver = yield* ModelLayerResolver
      const modelLayer = yield* resolver.resolve('/tmp', { id: MOCK_MODEL_ID })
      expect(modelLayer).toBeDefined()
      if (!modelLayer) return
      const partsFiber = yield* Effect.gen(function* () {
        const model = yield* LanguageModel.LanguageModel
        return yield* model.streamText({ prompt: [] }).pipe(Stream.runCollect)
      }).pipe(Effect.provide(modelLayer), Effect.forkChild)
      yield* TestClock.adjust('1 second')
      const parts = yield* Fiber.join(partsFiber)
      const tags = parts.map((part) => part.type)
      expect(tags).toContain('reasoning-delta')
      expect(tags.filter((tag) => tag === 'text-delta').length).toBeGreaterThan(
        1
      )
      expect(tags).toContain('finish')
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ModelLayerResolverLive,
          enabled('streaming'),
          noCredentials
        )
      )
    )
  )
})
