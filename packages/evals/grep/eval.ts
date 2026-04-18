/**
 * grep eval — agentic eval exercising the Grep tool.
 *
 * Each scenario seeds files with known content, then asks the model to
 * search for patterns using the Grep tool. Verification checks the model's
 * text response for the expected filenames — proving it can translate
 * natural-language search requests into correct regex patterns and tool
 * parameters.
 *
 * Scenarios cover: literal search, regex patterns, file-type filtering
 * via `include`, directory scoping via `path`, and match counting.
 */
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { FetchHttpClient } from 'effect/unstable/http'
import { Config, Effect, Layer } from 'effect'
import {
  test,
  run,
  formatSuiteSummary,
  saveSuiteResult,
  defaultSuiteResultPath,
  makeTempDir,
} from '../bench/index.ts'
import {
  Toolkit,
  Grep,
  GrepHandler,
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

const GrepTools = Toolkit.make(Grep)
const GrepToolsLayer = GrepTools.toLayer({ ...GrepHandler })

// ---------------------------------------------------------------------------
// Harness config
// ---------------------------------------------------------------------------

const systemPrompt = `You are a code search assistant with access to a codebase.

You have one tool:
- Grep: searches file contents using regex patterns. Supports \`include\` to filter by file type (e.g. "*.ts") and \`path\` to scope the search to a directory.

Use the Grep tool to answer questions about what code exists. Report your findings clearly — mention specific file names and what you found in them.`

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface GrepScenario {
  readonly name: string
  /** Files to seed in the sandbox before the test. */
  readonly files: ReadonlyArray<{ path: string; content: string }>
  readonly prompt: string
  /** Check the model's text response. */
  readonly check: (response: string) => boolean
}

const scenarios: ReadonlyArray<GrepScenario> = [
  {
    name: 'find-string-in-files',
    files: [
      {
        path: 'app.ts',
        content: 'const API_KEY = "secret123"\nconsole.log(API_KEY)',
      },
      {
        path: 'utils.ts',
        content: 'export function add(a: number, b: number) { return a + b }',
      },
      {
        path: 'config.ts',
        content: 'export const API_KEY = process.env.API_KEY',
      },
    ],
    prompt: 'Which files contain "API_KEY"? Use the Grep tool to search.',
    check: (r) =>
      r.includes('app.ts') &&
      r.includes('config.ts') &&
      !r.includes('utils.ts'),
  },
  {
    name: 'regex-function-search',
    files: [
      {
        path: 'math.ts',
        content:
          'export function add(a: number, b: number) {\n  return a + b\n}',
      },
      {
        path: 'greet.ts',
        content:
          'export function greet(name: string) {\n  return `Hello, ${' +
          'name}`\n}',
      },
      {
        path: 'data.ts',
        content: 'export const items = [1, 2, 3]',
      },
    ],
    prompt:
      'Search for all function definitions using a regex pattern. Which files define functions?',
    check: (r) =>
      r.includes('math.ts') && r.includes('greet.ts') && !r.includes('data.ts'),
  },
  {
    name: 'filter-by-file-type',
    files: [
      {
        path: 'index.ts',
        content: 'import { foo } from "./foo"',
      },
      { path: 'style.css', content: '.foo { color: red }' },
      { path: 'app.ts', content: 'const foo = "bar"' },
      { path: 'readme.md', content: 'This project uses foo' },
    ],
    prompt:
      'Search for "foo" but only in TypeScript files (.ts). Use the include parameter to filter.',
    check: (r) =>
      r.includes('index.ts') &&
      r.includes('app.ts') &&
      !r.includes('style.css') &&
      !r.includes('readme.md'),
  },
  {
    name: 'search-in-subdirectory',
    files: [
      {
        path: 'src/main.ts',
        content: 'import { helper } from "./helper"',
      },
      {
        path: 'src/helper.ts',
        content: 'export function helper() { return "TODO: implement" }',
      },
      {
        path: 'test/main.test.ts',
        content: 'import { helper } from "../src/helper"\n// TODO: write tests',
      },
      { path: 'TODO.md', content: '# TODO\n- write tests' },
    ],
    prompt:
      'Search for "TODO" only within the src/ directory. Use the path parameter to scope the search.',
    check: (r) =>
      r.includes('helper.ts') &&
      !r.includes('main.test.ts') &&
      !r.includes('TODO.md'),
  },
  {
    name: 'count-matches',
    files: [
      { path: 'a.ts', content: 'export const x = 1' },
      { path: 'b.ts', content: 'export const y = 2' },
      { path: 'c.ts', content: 'export const z = 3' },
      { path: 'd.ts', content: 'const local = 4' },
      { path: 'e.js', content: 'export const w = 5' },
    ],
    prompt:
      'How many files contain the word "export"? Use the Grep tool to search, then tell me the count.',
    check: (r) => r.includes('4'),
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tests = scenarios.map((scenario) => {
  const runScenario = Effect.gen(function* () {
    const sandboxFactory = yield* Sandbox
    const dir = yield* makeTempDir
    const { shell, files } = yield* sandboxFactory.acquire(dir)

    // Seed the filesystem
    for (const file of scenario.files) {
      yield* files.writeFile(file.path, file.content)
    }

    return yield* test(
      { systemPrompt, toolkit: GrepTools },
      {
        name: scenario.name,
        prompt: scenario.prompt,
        check: scenario.check,
      }
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CurrentShell, shell),
          Layer.succeed(CurrentFiles, files)
        )
      )
    )
  })

  return Effect.scoped(runScenario)
})

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

  const path = defaultSuiteResultPath('grep')
  yield* saveSuiteResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(
  Effect.provide(
    Layer.mergeAll(GrepToolsLayer, LocalSandboxLive, AnthropicLive)
  )
)

export const suite: EvalSuite = {
  name: 'grep',
  description:
    'Agent searches file contents via Grep tool — literal strings, regex, file filtering, directory scoping.',
  run: suiteRun,
}
