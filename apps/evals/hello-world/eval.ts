/**
 * hello-world eval — the simplest possible vertical slice.
 *
 * No tools, no sandbox. Just prompt → model → check.
 * Demonstrates that test works for simple tests too — the HarnessConfig
 * is just empty.
 */
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { FetchHttpClient } from '@effect/platform'
import { Config, Effect, Layer } from 'effect'
import {
  test,
  run,
  formatSuiteSummary,
  saveSuiteResult,
  defaultSuiteResultPath,
} from '@agents/bench'
import type { HarnessConfig } from '@agents/core'
import type { SuiteResult } from '@agents/bench'
import type { EvalSuite } from '../suite.ts'

// ---------------------------------------------------------------------------
// Harness config — empty, no tools needed
// ---------------------------------------------------------------------------

const config: HarnessConfig = {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tests = [
  test(config, {
    name: 'hello-world',
    prompt: "Say 'Hello, World!' and nothing else.",
    check: (r) => r.includes('Hello, World!'),
  }),
  test(config, {
    name: 'simple-math',
    prompt: 'What is 2 + 2? Reply with just the number.',
    check: (r) => r.includes('4'),
  }),
  test(config, {
    name: 'color-of-sky',
    prompt: 'What color is the sky on a clear day? Reply with one word.',
    check: (r) => r.toLowerCase().includes('blue'),
  }),
  test(config, {
    name: 'reverse-greeting',
    prompt: "Say 'Goodbye!' and nothing else.",
    check: (r) => r.includes('Goodbye!'),
  }),
]

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const AnthropicLive = AnthropicLanguageModel.layer({
  model: 'claude-haiku-4-5-20251001',
}).pipe(
  Layer.provide(
    AnthropicClient.layerConfig({
      apiKey: Config.redacted('ANTHROPIC_API_KEY'),
    })
  ),
  Layer.provide(FetchHttpClient.layer)
)

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const suiteRun = Effect.gen(function* () {
  const result: SuiteResult = yield* run(tests)

  console.log(formatSuiteSummary(result))

  const path = defaultSuiteResultPath('hello-world')
  yield* saveSuiteResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(Effect.provide(AnthropicLive))

export const suite: EvalSuite = {
  name: 'hello-world',
  description:
    'Trivial prompt/response scenarios — the simplest vertical slice.',
  run: suiteRun,
}
