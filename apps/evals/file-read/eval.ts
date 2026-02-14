/**
 * file-read eval — the first agentic eval.
 *
 * Tests the agent's ability to use the ReadFile tool to read a file from the
 * sandbox and answer a question about its contents. The simplest possible
 * demonstration of tool use through the sandbox boundary.
 */
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { FetchHttpClient } from '@effect/platform'
import { Config, Effect, Layer } from 'effect'
import {
  fromArray,
  contains,
  runBenchmark,
  formatSummary,
  saveResult,
  defaultResultPath,
} from '@agents/bench'
import { LocalSandboxLive, SandboxError } from '@agents/core'
import type { Scenario } from '@agents/bench'
import { AgentToolkit, AgentToolkitLive } from '@agents/core/tool'
import type { EvalSuite } from '../suite.ts'

// ---------------------------------------------------------------------------
// Scenario shape
// ---------------------------------------------------------------------------

/**
 * Each scenario seeds a file into the sandbox and asks the agent a question
 * about it. The agent must use ReadFile to get the contents, then answer.
 */
interface FileReadInput {
  /** Path where the file will be created (relative to sandbox cwd). */
  readonly filePath: string
  /** Contents to seed into the file before the agent runs. */
  readonly fileContents: string
  /** The question the agent must answer by reading the file. */
  readonly question: string
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

const scenarios: ReadonlyArray<Scenario<FileReadInput>> = [
  {
    id: 'read-greeting',
    input: {
      filePath: '/tmp/agents-eval/greeting.txt',
      fileContents: 'Hello from the sandbox!',
      question:
        "Read the file at /tmp/agents-eval/greeting.txt and tell me exactly what it says. Reply with only the file's contents, nothing else.",
    },
    rubric: contains('Hello from the sandbox!'),
  },
  {
    id: 'read-count-lines',
    input: {
      filePath: '/tmp/agents-eval/lines.txt',
      fileContents: 'line one\nline two\nline three\nline four\nline five',
      question:
        'Read the file at /tmp/agents-eval/lines.txt and count how many lines it has. Reply with just the number.',
    },
    rubric: contains('5'),
  },
  {
    id: 'read-extract-value',
    input: {
      filePath: '/tmp/agents-eval/config.json',
      fileContents: JSON.stringify(
        { name: 'test-project', version: '1.2.3', author: 'Agent' },
        null,
        2
      ),
      question:
        'Read the file at /tmp/agents-eval/config.json and tell me the version. Reply with just the version string.',
    },
    rubric: contains('1.2.3'),
  },
]

const dataset = fromArray('file-read', scenarios)

// ---------------------------------------------------------------------------
// Harness config (effectful — resolves toolkit inside sandbox scope)
// ---------------------------------------------------------------------------

const harness = Effect.gen(function* () {
  const toolkit = yield* Effect.provide(AgentToolkit, AgentToolkitLive)

  return {
    systemPrompt: [
      'You are a precise assistant with access to a filesystem.',
      'Use the ReadFile tool to read files when asked about their contents.',
      'Answer concisely — only what was asked, nothing more.',
    ].join(' '),
    toolkit,
  }
})

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
// File seeding + benchmark
// ---------------------------------------------------------------------------

/**
 * Seed scenario files into the filesystem before running the benchmark.
 * LocalSandbox uses the real filesystem, so we write directly.
 */
const seedFiles = Effect.forEach(scenarios, (scenario) =>
  Effect.tryPromise({
    try: () => Bun.write(scenario.input.filePath, scenario.input.fileContents),
    catch: (error) =>
      new SandboxError({
        operation: 'seedFile',
        message: `Failed to seed ${scenario.input.filePath}: ${error}`,
      }),
  })
)

/** Clean up seeded files after the benchmark. */
const cleanupFiles = Effect.tryPromise({
  try: () => Bun.spawn(['rm', '-rf', '/tmp/agents-eval']).exited,
  catch: (error) =>
    new SandboxError({
      operation: 'cleanup',
      message: `Failed to cleanup: ${error}`,
    }),
}).pipe(Effect.ignore)

// ---------------------------------------------------------------------------
// Suite export
// ---------------------------------------------------------------------------

const run = Effect.gen(function* () {
  // Seed files, run benchmark, clean up
  yield* seedFiles

  const result = yield* runBenchmark({
    dataset,
    harness,
    inputToPrompt: (input) => input.question,
  })

  yield* cleanupFiles

  console.log(formatSummary(result))

  const path = defaultResultPath(result)
  yield* saveResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(Effect.provide(MainLayer))

export const suite: EvalSuite = {
  name: 'file-read',
  description:
    'Agent reads files via ReadFile tool and answers questions about contents.',
  run,
}
