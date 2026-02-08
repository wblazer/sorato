/**
 * hello-world eval — the simplest possible vertical slice.
 *
 * A handful of trivial prompt→expected-string scenarios exercising the
 * full pipeline: Dataset → Harness → Rubric → Runner → Reporter.
 *
 * Run:  bun run evals/hello-world/main.ts
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
} from 'blazerbench'
import type { Scenario } from 'blazerbench'

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

const scenarios: ReadonlyArray<Scenario<string, string>> = [
  {
    id: 'hello-world',
    input: "Say 'Hello, World!' and nothing else.",
    expected: 'Hello, World!',
    metadata: {},
  },
  {
    id: 'simple-math',
    input: 'What is 2 + 2? Reply with just the number.',
    expected: '4',
    metadata: {},
  },
  {
    id: 'color-of-sky',
    input: 'What color is the sky on a clear day? Reply with one word.',
    expected: 'blue',
    metadata: {},
  },
  {
    id: 'reverse-greeting',
    input: "Say 'Goodbye!' and nothing else.",
    expected: 'Goodbye!',
    metadata: {},
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const result = yield* runStringBenchmark({
    dataset,
    harness: {},
    rubric: contains,
  })

  const summary = formatSummary(result)
  yield* Effect.log(summary)

  const path = defaultResultPath(result)
  yield* saveResult(result, path)
  yield* Effect.log(`Results saved to ${path}`)
})

const MainLayer = Layer.merge(AnthropicLive, LocalSandboxLive)

const runnable = program.pipe(Effect.provide(MainLayer))

Effect.runPromise(runnable).catch(console.error)
