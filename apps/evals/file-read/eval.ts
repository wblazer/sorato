/**
 * file-read eval — agentic eval with sandbox + ReadFile tool.
 *
 * Demonstrates the nested-effects pattern:
 *   - Model provided at the suite level
 *   - Harness config (system prompt, toolkit) shared via closure
 *   - Each test acquires a fresh sandbox, seeds files, runs, cleans up
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
import {
  Toolkit,
  ReadFile,
  ReadFileHandler,
  Sandbox,
  CurrentSandbox,
  LocalSandboxLive,
  SandboxError,
} from '@agents/core'
import type { EvalSuite } from '../suite.ts'
import type { SuiteResult } from '@agents/bench'

// ---------------------------------------------------------------------------
// Toolkit — composed from individual tools
// ---------------------------------------------------------------------------

const FileTools = Toolkit.make(ReadFile)
const FileToolsLayer = FileTools.toLayer(ReadFileHandler)

// ---------------------------------------------------------------------------
// Harness config — shared across all tests in this suite
// ---------------------------------------------------------------------------

const systemPrompt =
  'You are a precise assistant with access to a filesystem. Use the ReadFile tool to read files when asked about their contents. Answer concisely — only what was asked, nothing more.'

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

interface FileScenario {
  readonly name: string
  readonly filePath: string
  readonly fileContents: string
  readonly prompt: string
  readonly expected: string
}

const scenarios: ReadonlyArray<FileScenario> = [
  {
    name: 'read-greeting',
    filePath: '/tmp/agents-eval/greeting.txt',
    fileContents: 'Hello from the sandbox!',
    prompt:
      "Read the file at /tmp/agents-eval/greeting.txt and tell me exactly what it says. Reply with only the file's contents, nothing else.",
    expected: 'Hello from the sandbox!',
  },
  {
    name: 'read-count-lines',
    filePath: '/tmp/agents-eval/lines.txt',
    fileContents: 'line one\nline two\nline three\nline four\nline five',
    prompt:
      'Read the file at /tmp/agents-eval/lines.txt and count how many lines it has. Reply with just the number.',
    expected: '5',
  },
  {
    name: 'read-extract-value',
    filePath: '/tmp/agents-eval/config.json',
    fileContents: JSON.stringify(
      { name: 'test-project', version: '1.2.3', author: 'Agent' },
      null,
      2
    ),
    prompt:
      'Read the file at /tmp/agents-eval/config.json and tell me the version. Reply with just the version string.',
    expected: '1.2.3',
  },
]

// ---------------------------------------------------------------------------
// Per-test sandbox lifecycle
// ---------------------------------------------------------------------------

/** Seed a file into the real filesystem for the sandbox to read. */
const seedFile = (path: string, contents: string) =>
  Effect.tryPromise({
    try: () => Bun.write(path, contents),
    catch: (error) =>
      new SandboxError({
        operation: 'seedFile',
        message: `Failed to seed ${path}: ${error}`,
      }),
  })

const cleanup = Effect.tryPromise({
  try: () => Bun.spawn(['rm', '-rf', '/tmp/agents-eval']).exited,
  catch: (error) =>
    new SandboxError({
      operation: 'cleanup',
      message: `Failed to cleanup: ${error}`,
    }),
}).pipe(Effect.ignore)

// ---------------------------------------------------------------------------
// Tests — each leaf is an Effect you can read top-to-bottom
// ---------------------------------------------------------------------------

const tests = scenarios.map((scenario) =>
  Effect.gen(function* () {
    // Seed the file this test needs
    yield* seedFile(scenario.filePath, scenario.fileContents)

    // Acquire a fresh sandbox for this test
    const sandboxFactory = yield* Sandbox
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const sandbox = yield* sandboxFactory.acquire
        return yield* test(
          { systemPrompt, toolkit: FileTools },
          {
            name: scenario.name,
            prompt: scenario.prompt,
            check: (response) => response.includes(scenario.expected),
          }
        ).pipe(Effect.provide(Layer.succeed(CurrentSandbox, sandbox)))
      })
    )
  })
)

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
// Suite
// ---------------------------------------------------------------------------

const suiteRun = Effect.gen(function* () {
  const result: SuiteResult = yield* run(tests)
  yield* cleanup

  console.log(formatSuiteSummary(result))

  const path = defaultSuiteResultPath('file-read')
  yield* saveSuiteResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(
  Effect.provide(
    Layer.mergeAll(FileToolsLayer, LocalSandboxLive, AnthropicLive)
  )
)

export const suite: EvalSuite = {
  name: 'file-read',
  description:
    'Agent reads files via ReadFile tool and answers questions about contents.',
  run: suiteRun,
}
