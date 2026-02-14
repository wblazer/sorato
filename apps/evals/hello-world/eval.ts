/**
 * hello-world eval suite — the simplest possible vertical slice.
 *
 * A handful of trivial prompt->expected-string scenarios exercising the
 * full pipeline: Dataset -> Harness -> Runner -> Reporter.
 */
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { FetchHttpClient } from '@effect/platform'
import { Config, Effect, Layer } from 'effect'
import {
  fromArray,
  contains,
  runStringBenchmark,
  LocalSandboxLive,
  formatSummary,
  saveResult,
  defaultResultPath,
} from '@agents/core'
import type { Scenario, HarnessConfig } from '@agents/core'
import type { EvalSuite } from '../suite.ts'

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

const scenarios: ReadonlyArray<Scenario> = [
  {
    id: 'hello-world',
    input: "Say 'Hello, World!' and nothing else.",
    rubric: contains('Hello, World!'),
  },
  {
    id: 'simple-math',
    input: 'What is 2 + 2? Reply with just the number.',
    rubric: contains('4'),
  },
  {
    id: 'color-of-sky',
    input: 'What color is the sky on a clear day? Reply with one word.',
    rubric: contains('blue'),
  },
  {
    id: 'reverse-greeting',
    input: "Say 'Goodbye!' and nothing else.",
    rubric: contains('Goodbye!'),
  },
]

const dataset = fromArray('hello-world', scenarios)

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const AnthropicLive = AnthropicLanguageModel.layer({
  model: 'claude-sonnet-4-20250514',
}).pipe(
  Layer.provide(
    AnthropicClient.layerConfig({
      apiKey: Config.redacted('ANTHROPIC_API_KEY'),
    })
  ),
  Layer.provide(FetchHttpClient.layer)
)

const MainLayer = Layer.merge(AnthropicLive, LocalSandboxLive)

// ---------------------------------------------------------------------------
// Suite export
// ---------------------------------------------------------------------------

const run = Effect.gen(function* () {
  const result = yield* runStringBenchmark({
    dataset,
    harness: Effect.succeed({} satisfies HarnessConfig),
  })

  console.log(formatSummary(result))

  const path = defaultResultPath(result)
  yield* saveResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(Effect.provide(MainLayer))

export const suite: EvalSuite = {
  name: 'hello-world',
  description:
    'Trivial prompt/response scenarios — the simplest vertical slice.',
  run,
}
