/**
 * glob eval — agentic eval exercising the Glob tool.
 *
 * Each scenario seeds a directory tree with known files, then asks the model
 * to find files matching certain criteria using the Glob tool. Verification
 * checks the model's text response for the expected filenames.
 *
 * The model must demonstrate it can translate natural-language file search
 * requests into correct glob patterns — a core skill for codebase navigation.
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
  Glob,
  GlobHandler,
  Sandbox,
  CurrentShell,
  CurrentFiles,
  LocalSandboxLive,
} from '@agents/core'
import type { EvalSuite } from '../suite.ts'
import type { SuiteResult } from '@agents/bench'

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

const GlobTools = Toolkit.make(Glob)
const GlobToolsLayer = GlobTools.toLayer({ ...GlobHandler })

// ---------------------------------------------------------------------------
// Harness config
// ---------------------------------------------------------------------------

const systemPrompt = `You are a file search assistant with access to a filesystem.

You have one tool:
- Glob: finds files matching a glob pattern. Supports *, **, ?, and {a,b} syntax.

Use the Glob tool to answer questions about what files exist. Report the matching file paths clearly in your response.`

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface GlobScenario {
  readonly name: string
  /** Files to seed in the sandbox before the test. */
  readonly files: ReadonlyArray<{ path: string; content: string }>
  readonly prompt: string
  /** Check the model's text response mentions the right files. */
  readonly check: (response: string) => boolean
}

const scenarios: ReadonlyArray<GlobScenario> = [
  {
    name: 'find-ts-files',
    files: [
      { path: 'app.ts', content: 'console.log("app")' },
      { path: 'utils.ts', content: 'export {}' },
      { path: 'style.css', content: 'body {}' },
      { path: 'readme.md', content: '# hi' },
    ],
    prompt: 'Find all TypeScript (.ts) files. List the matching file paths.',
    check: (r) =>
      r.includes('app.ts') &&
      r.includes('utils.ts') &&
      !r.includes('style.css') &&
      !r.includes('readme.md'),
  },
  {
    name: 'find-in-subdirectory',
    files: [
      { path: 'src/foo.ts', content: '' },
      { path: 'src/bar.ts', content: '' },
      { path: 'lib/baz.ts', content: '' },
      { path: 'root.ts', content: '' },
    ],
    prompt:
      'Find all files inside the src/ directory. List the matching file paths.',
    check: (r) =>
      r.includes('src/foo.ts') &&
      r.includes('src/bar.ts') &&
      !r.includes('lib/baz.ts'),
  },
  {
    name: 'find-json-recursive',
    files: [
      { path: 'config.json', content: '{}' },
      { path: 'data/items.json', content: '[]' },
      { path: 'data/nested/deep.json', content: '{}' },
      { path: 'src/index.ts', content: '' },
    ],
    prompt:
      'Find all JSON files, including in subdirectories. List the matching file paths.',
    check: (r) =>
      r.includes('config.json') &&
      r.includes('items.json') &&
      r.includes('deep.json') &&
      !r.includes('index.ts'),
  },
  {
    name: 'count-matches',
    files: [
      { path: 'a.ts', content: '' },
      { path: 'b.ts', content: '' },
      { path: 'c.ts', content: '' },
      { path: 'd.ts', content: '' },
      { path: 'e.js', content: '' },
    ],
    prompt:
      'How many TypeScript (.ts) files are there? Use the Glob tool to find them, then tell me the count.',
    check: (r) => r.includes('4'),
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tests = scenarios.map((scenario) =>
  Effect.gen(function* () {
    const sandboxFactory = yield* Sandbox
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const { shell, files } = yield* sandboxFactory.acquire

        // Seed the filesystem
        for (const file of scenario.files) {
          yield* files.writeFile(file.path, file.content)
        }

        const result = yield* test(
          { systemPrompt, toolkit: GlobTools },
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

        return result
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

  const path = defaultSuiteResultPath('glob')
  yield* saveSuiteResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(
  Effect.provide(
    Layer.mergeAll(GlobToolsLayer, LocalSandboxLive, AnthropicLive)
  )
)

export const suite: EvalSuite = {
  name: 'glob',
  description:
    'Agent finds files via Glob tool — pattern matching, subdirectories, counting.',
  run: suiteRun,
}
