/**
 * file-edit eval — agentic eval exercising the hashline ReadFile + EditFile pair.
 *
 * Each scenario seeds a file with a known bug (mechanical mutation), gives the
 * model a description of the issue, and checks whether the model can read the
 * file, identify the problem, and fix it using the EditFile tool's hashline
 * anchors.
 *
 * Inspired by the approach in https://blog.can.ac/2026/02/12/the-harness-problem/
 * — mutations are mechanical enough that the expected fix is unambiguous, but
 * the model must demonstrate it can use the hashline protocol correctly.
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
  makeTempDir,
} from '../bench/index.ts'
import {
  Toolkit,
  ReadFile,
  ReadFileHandler,
  EditFile,
  EditFileHandler,
  Sandbox,
  CurrentShell,
  CurrentFiles,
  LocalSandboxLive,
} from '@agents/agent'
import type { EvalSuite } from '../suite.ts'
import type { SuiteResult } from '../bench/index.ts'

// ---------------------------------------------------------------------------
// Toolkit — hashline read + edit bundle
// ---------------------------------------------------------------------------

const FileTools = Toolkit.make(ReadFile, EditFile)
const FileToolsLayer = FileTools.toLayer({
  ...ReadFileHandler,
  ...EditFileHandler,
})

// ---------------------------------------------------------------------------
// Harness config
// ---------------------------------------------------------------------------

const systemPrompt = `You are a precise code editor with access to a filesystem.

You have two tools:
- ReadFile: reads a file and returns lines with content-hash anchors in the format \`<line>:<hash>|<content>\`
- EditFile: edits a file using anchors from the last ReadFile output

Workflow: always ReadFile first to get the current anchors, then use EditFile to make changes. Each anchor is \`<line>:<hash>\` — use these exactly as shown in the ReadFile output.

Fix exactly what is described in the task. Do not add, remove, or change anything else.`

// ---------------------------------------------------------------------------
// Scenarios — each is a file with a mechanical bug and its fix
// ---------------------------------------------------------------------------

interface EditScenario {
  readonly name: string
  readonly filePath: string
  /** The correct version of the file. */
  readonly original: string
  /** The mutated version (has the bug). Seeded into the sandbox. */
  readonly mutated: string
  /** Task description given to the model. */
  readonly prompt: string
}

const scenarios: ReadonlyArray<EditScenario> = [
  {
    name: 'fix-operator-swap',
    filePath: 'math.ts',
    original: [
      'function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
    ].join('\n'),
    mutated: [
      'function add(a: number, b: number): number {',
      '  return a - b;',
      '}',
    ].join('\n'),
    prompt:
      'Fix the bug in math.ts: the `add` function uses the wrong operator. It should add, not subtract.',
  },
  {
    name: 'fix-boolean-flip',
    filePath: 'config.ts',
    original: [
      'export const config = {',
      '  debug: false,',
      '  verbose: true,',
      '  maxRetries: 3,',
      '};',
    ].join('\n'),
    mutated: [
      'export const config = {',
      '  debug: true,',
      '  verbose: true,',
      '  maxRetries: 3,',
      '};',
    ].join('\n'),
    prompt:
      'Fix the bug in config.ts: `debug` should be `false` but it is set to `true`.',
  },
  {
    name: 'fix-missing-return',
    filePath: 'greet.ts',
    original: [
      'function greet(name: string): string {',
      '  const greeting = `Hello, ${name}!`;',
      '  return greeting;',
      '}',
    ].join('\n'),
    mutated: [
      'function greet(name: string): string {',
      '  const greeting = `Hello, ${name}!`;',
      '}',
    ].join('\n'),
    prompt:
      'Fix the bug in greet.ts: the `greet` function is missing its return statement. It should return the `greeting` variable.',
  },
  {
    name: 'fix-off-by-one',
    filePath: 'range.ts',
    original: [
      'function range(n: number): number[] {',
      '  const result: number[] = [];',
      '  for (let i = 0; i < n; i++) {',
      '    result.push(i);',
      '  }',
      '  return result;',
      '}',
    ].join('\n'),
    mutated: [
      'function range(n: number): number[] {',
      '  const result: number[] = [];',
      '  for (let i = 0; i <= n; i++) {',
      '    result.push(i);',
      '  }',
      '  return result;',
      '}',
    ].join('\n'),
    prompt:
      'Fix the off-by-one bug in range.ts: the loop condition should be `i < n`, not `i <= n`.',
  },
  {
    name: 'fix-string-literal',
    filePath: 'message.ts',
    original: [
      'export function getMessage(): string {',
      '  return "Hello, World!";',
      '}',
    ].join('\n'),
    mutated: [
      'export function getMessage(): string {',
      '  return "Goodbye, World!";',
      '}',
    ].join('\n'),
    prompt:
      'Fix the bug in message.ts: the getMessage function should return "Hello, World!" but it returns "Goodbye, World!".',
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Normalize whitespace for comparison — trim lines, collapse blank lines. */
const normalize = (s: string): string =>
  s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()

const tests = scenarios.map((scenario) =>
  Effect.gen(function* () {
    const sandboxFactory = yield* Sandbox
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* makeTempDir
        const { shell, files } = yield* sandboxFactory.acquire(dir)

        // Seed the mutated file
        yield* files.writeFile(scenario.filePath, scenario.mutated)

        const result = yield* test(
          { systemPrompt, toolkit: FileTools },
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

        // The real check: did the file get fixed?
        const finalContent = yield* files.readFile(scenario.filePath)
        const passed = normalize(finalContent) === normalize(scenario.original)

        return {
          ...result,
          passed,
          reason: passed
            ? undefined
            : `File content after edit did not match expected.\n--- Expected ---\n${scenario.original}\n--- Got ---\n${finalContent}`,
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

  const path = defaultSuiteResultPath('file-edit')
  yield* saveSuiteResult(result, path)
  console.log(`Results saved to ${path}`)

  return result
}).pipe(
  Effect.provide(
    Layer.mergeAll(FileToolsLayer, LocalSandboxLive, AnthropicLive)
  )
)

export const suite: EvalSuite = {
  name: 'file-edit',
  description:
    'Agent reads files via hashline ReadFile, fixes bugs via EditFile with content-hash anchors.',
  run: suiteRun,
}
