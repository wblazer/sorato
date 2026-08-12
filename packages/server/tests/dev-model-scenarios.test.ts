import { Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { Chat, Prompt } from 'effect/unstable/ai'
import { describe, expect, it } from '@effect/vitest'
import {
  DevLanguageModelResolverLive,
  DevModelCatalogLive,
} from '../src/dev/model-scenarios.ts'
import {
  LanguageModelResolver,
  ModelCatalog,
  type ModelPurpose,
} from '../src/model-catalog.ts'
import { ProviderAuthStore } from '../src/provider-auth.ts'
import { RuntimeConfigService } from '../src/runtime-config.ts'

const providerAuthLayer = Layer.succeed(ProviderAuthStore, {
  getAuth: () => Effect.succeed(undefined),
  setApiKey: () => Effect.void,
  setOauth: () => Effect.void,
  providerApiKey: () => Effect.succeed(undefined),
  hasProviderAuth: () => Effect.succeed(false),
})

const runtimeConfigLayer = Layer.succeed(RuntimeConfigService, {
  get: () =>
    Effect.succeed({
      default_model: null,
      environment_command: null,
      instructions: [],
      roles: {
        summary: { model: null, instructions: [] },
        title: { model: null, instructions: [] },
      },
    }),
})

const testLayer = Layer.mergeAll(
  DevModelCatalogLive,
  DevLanguageModelResolverLive,
  providerAuthLayer,
  runtimeConfigLayer
)

const responseText = (scenario: string, purpose: ModelPurpose) =>
  Effect.gen(function* () {
    const resolver = yield* LanguageModelResolver
    const resolved = yield* resolver.resolve('/tmp', { id: scenario }, purpose)
    if (resolved === undefined)
      return yield* Effect.die(new Error(`Scenario not resolved: ${scenario}`))

    const chat = yield* Chat.fromPrompt(
      Prompt.make([{ role: 'user', content: 'test' }])
    )
    const parts = yield* chat
      .streamText({ prompt: [] })
      .pipe(Stream.runCollect, Effect.provide(resolved.layer))

    return {
      deltas: Array.from(parts).flatMap((part) =>
        part.type === 'text-delta' ? [part.delta] : []
      ),
      reasoningDeltas: Array.from(parts).flatMap((part) =>
        part.type === 'reasoning-delta' ? [part.delta] : []
      ),
      attribution: resolved.attribution,
    }
  })

describe('development model scenarios', () => {
  it.effect('lists scenarios without provider credentials', () =>
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog
      const result = yield* catalog.list('/tmp')

      expect(result.models.length).toBeGreaterThan(0)
      expect(result.models.every((model) => model.kind === 'scenario')).toBe(
        true
      )
      expect(result.models.map((model) => model.id)).toContain(
        'scenario/streaming-markdown'
      )
      expect(result.models.map((model) => model.id)).toContain(
        'scenario/plan-compaction'
      )
    }).pipe(Effect.provide(testLayer))
  )

  it.effect('resolves purpose-specific scripts through one model service', () =>
    Effect.gen(function* () {
      const title = yield* responseText('scenario/streaming-markdown', 'title')
      const summary = yield* responseText(
        'scenario/streaming-markdown',
        'summary'
      ).pipe(Effect.forkChild)
      const agent = yield* responseText(
        'scenario/streaming-markdown',
        'agent'
      ).pipe(Effect.forkChild)
      const reasoning = yield* responseText('scenario/reasoning', 'agent').pipe(
        Effect.forkChild
      )

      yield* Effect.yieldNow
      expect(summary.pollUnsafe()).toBeUndefined()
      expect(agent.pollUnsafe()).toBeUndefined()
      expect(reasoning.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust(Duration.seconds(10))

      const summaryResult = yield* Fiber.join(summary)
      const agentResult = yield* Fiber.join(agent)
      const reasoningResult = yield* Fiber.join(reasoning)

      expect(title.deltas.join('')).toBe('Streaming Markdown')
      expect(summaryResult.deltas.join('')).toContain('deterministic work')
      expect(summaryResult.deltas.length).toBeGreaterThan(3)
      expect(summaryResult.deltas).toContain('deterministic ')
      expect(agentResult.deltas.length).toBeGreaterThan(1)
      expect(reasoningResult.reasoningDeltas.length).toBeGreaterThan(1)
      expect(reasoningResult.reasoningDeltas.join('')).toContain(
        'deterministic response'
      )
      expect(title.attribution).toEqual({
        providerId: 'scenario',
        modelId: 'streaming-markdown',
        billingMode: 'unbilled',
        cost: undefined,
      })
    }).pipe(Effect.provide(testLayer))
  )

  it.effect('provides valid plan-compaction summary output', () =>
    Effect.gen(function* () {
      const response = yield* responseText(
        'scenario/plan-compaction',
        'summary'
      ).pipe(Effect.forkChild)

      yield* Effect.yieldNow
      yield* TestClock.adjust(Duration.seconds(20))

      expect(JSON.parse((yield* Fiber.join(response)).deltas.join(''))).toEqual(
        {
          summaries: [
            {
              rangeIndex: 0,
              content:
                'The project manifest inspection completed using the real Glob tool. The plan is ready to advance to reporting.',
            },
          ],
        }
      )
    }).pipe(Effect.provide(testLayer))
  )

  it.effect('rejects unknown scenarios at catalog admission', () =>
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog
      const error = yield* catalog
        .ensure('/tmp', 'scenario/not-defined')
        .pipe(Effect.flip)

      expect(error._tag).toBe('ModelUnavailable')
    }).pipe(Effect.provide(testLayer))
  )

  it.effect('accepts the disabled-thinking option used by summaries', () =>
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog
      const scenario = yield* catalog.ensure(
        '/tmp',
        'scenario/streaming-markdown',
        { thinkingLevel: 'off' }
      )

      expect(scenario.kind).toBe('scenario')
    }).pipe(Effect.provide(testLayer))
  )
})
