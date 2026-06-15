/**
 * Guards the mode -> provider request mapping.
 *
 * Regression: `fast` mode hardcoded OpenAI `service_tier: 'flex'`. OpenAI only
 * accepts `flex` for a limited model set and rejects it elsewhere with HTTP 400
 * ("Unsupported service_tier" / "Flex is not available for this model"). The
 * catalog (sourced from models.dev) actually declares the `fast` mode for these
 * models as `service_tier: 'priority'`. The tier must come from that data, not
 * a guess.
 */
import { describe, expect, it } from '@effect/vitest'
import {
  modeServiceTier,
  modeWantsFastSpeed,
} from '../src/provider-adapters.ts'
import { MODEL_PROVIDERS } from '../src/models.generated.ts'

const hasFastMode = (modes: ReadonlyArray<string>): boolean =>
  modes.includes('fast')

const modelsOf = (provider: string) =>
  MODEL_PROVIDERS.find((item) => item.id === provider)?.models ?? []

const openAiFastModels = modelsOf('openai').filter((model) =>
  hasFastMode(model.capabilities.modes)
)

const anthropicFastModels = modelsOf('anthropic').filter((model) =>
  hasFastMode(model.capabilities.modes)
)

describe('modeServiceTier', () => {
  it('maps OpenAI fast mode to priority, never flex', () => {
    expect(openAiFastModels.length).toBeGreaterThan(0)
    for (const model of openAiFastModels) {
      const tier = modeServiceTier('openai', { id: model.id, mode: 'fast' })
      expect(tier).toBe('priority')
      expect(tier).not.toBe('flex')
    }
  })

  it('returns undefined when no mode is selected', () => {
    const model = openAiFastModels[0]
    expect(model).toBeDefined()
    if (model !== undefined) {
      expect(modeServiceTier('openai', { id: model.id })).toBeUndefined()
    }
  })

  it('returns undefined for a model without the selected mode', () => {
    const plain = modelsOf('openai').find(
      (model) => !hasFastMode(model.capabilities.modes)
    )
    expect(plain).toBeDefined()
    if (plain !== undefined) {
      expect(
        modeServiceTier('openai', { id: plain.id, mode: 'fast' })
      ).toBeUndefined()
    }
  })
})

describe('modeWantsFastSpeed', () => {
  it('is true for Anthropic fast-mode models in fast mode', () => {
    expect(anthropicFastModels.length).toBeGreaterThan(0)
    for (const model of anthropicFastModels) {
      expect(modeWantsFastSpeed({ id: model.id, mode: 'fast' })).toBe(true)
    }
  })

  it('is false when no mode is selected', () => {
    const model = anthropicFastModels[0]
    expect(model).toBeDefined()
    if (model !== undefined) {
      expect(modeWantsFastSpeed({ id: model.id })).toBe(false)
    }
  })

  it('is false for models without a fast mode', () => {
    const plain = modelsOf('anthropic').find(
      (model) => !hasFastMode(model.capabilities.modes)
    )
    expect(plain).toBeDefined()
    if (plain !== undefined) {
      expect(modeWantsFastSpeed({ id: plain.id, mode: 'fast' })).toBe(false)
    }
  })
})
