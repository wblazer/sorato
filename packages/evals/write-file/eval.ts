/**
 * write-file eval — agentic eval exercising the WriteFile tool.
 *
 * Each scenario asks the model to create a file with specific content, then
 * verifies the file was actually written correctly. Tests range from simple
 * text files to nested paths and structured data — all things a model
 * needs to do fluently in real-world coding tasks.
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
} from '../bench/index.ts'
import {
  Toolkit,
  WriteFile,
  WriteFileHandler,
  Sandbox,
  CurrentShell,
  CurrentFiles,
  LocalSandboxLive,
} from '@agents/agent'
import type { EvalSuite } from '../suite.ts'
import type { SuiteResult } from '../bench/index.ts'

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

const WriteTools = Toolkit.make(WriteFile)
const WriteToolsLayer = WriteTools.toLayer({ ...WriteFileHandler })

// ---------------------------------------------------------------------------
// Harness config
// ---------------------------------------------------------------------------

const systemPrompt = `You are a file creation assistant with access to a filesystem.

You have one tool:
- WriteFile: creates or overwrites a file at the given path with the given content

Create exactly what is asked. Do not add extra content, comments, or formatting beyond what is requested.`

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface WriteScenario {
  readonly name: string
  readonly prompt: string
  readonly filePath: string
  /** Check the written file's content. */
  readonly check: (content: string) => boolean
}

const scenarios: ReadonlyArray<WriteScenario> = [
  {
    name: 'create-text-file',
    prompt:
      'Create a file called hello.txt containing exactly this text: Hello, World!',
    filePath: 'hello.txt',
    check: (c) => c.trim() === 'Hello, World!',
  },
  {
    name: 'create-nested-path',
    prompt:
      'Create a file at src/utils/math.ts with the content: export const add = (a: number, b: number) => a + b;',
    filePath: 'src/utils/math.ts',
    check: (c) => c.includes('export const add') && c.includes('a + b'),
  },
  {
    name: 'create-json-file',
    prompt:
      'Create a file called config.json containing a JSON object with two fields: "name" set to "my-app" and "version" set to "1.0.0". Output valid JSON only.',
    filePath: 'config.json',
    check: (c) => {
      try {
        const parsed = JSON.parse(c)
        return parsed.name === 'my-app' && parsed.version === '1.0.0'
      } catch {
        return false
      }
    },
  },
  {
    name: 'create-multiline',
    prompt: `Create a file called lines.txt with exactly these four lines:
first
second
third
fourth`,
    filePath: 'lines.txt',
    check: (c) => {
      const lines = c.trim().split('\n')
      return (
        lines.length === 4 &&
        lines[0] === 'first' &&
        lines[1] === 'second' &&
        lines[2] === 'third' &&
        lines[3] === 'fourth'
      )
    },
  },
  {
    name: 'create-deeply-nested',
    prompt: 'Create a file at a/b/c/d/deep.txt containing: You found me!',
    filePath: 'a/b/c/d/deep.txt',
    check: (c) => c.trim() === 'You found me!',
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const normalize = (s: string): string => s.trimEnd()

const tests = scenarios.map((scenario) =>
  Effect.gen(function* () {
    const sandboxFactory = yield* Sandbox
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const { shell, files } = yield* sandboxFactory.acquire

        const result = yield* test(
          { systemPrompt, toolkit: WriteTools },
          {
            name: scenario.name,
            prompt: scenario.prompt,
            check: () => true, // placeholder — we check file content below
          }
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(CurrentShell, shell),
              Layer.succeed(CurrentFiles, files)
            )
          )
        )

        // The real check: did the file get written correctly?
        const content = yield* files
          .readFile(scenario.filePath)
          .pipe(Effect.catchAll(() => Effect.succeed('')))
        const passed = scenario.check(normalize(content))

        return {
          ...result,
          passed,
          reason: passed
            ? undefined
            : `File content check failed.\n--- Got ---\n${content || '(file not found)'}`,
        }
      })
    )
  })
)

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

  const path = defaultSuiteResultPath('write-file')
  yield* saveSuiteResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(
  Effect.provide(
    Layer.mergeAll(WriteToolsLayer, LocalSandboxLive, AnthropicLive)
  )
)

export const suite: EvalSuite = {
  name: 'write-file',
  description:
    'Agent creates files via WriteFile — text, JSON, nested paths, multiline content.',
  run: suiteRun,
}
