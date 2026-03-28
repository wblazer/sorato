/**
 * Eval primitives — tests are just Effects.
 *
 * A test is an Effect that produces a TestResult. Its R parameter declares
 * what it needs (LanguageModel, tool handlers, etc.) — the caller provides
 * those via Effect.provide at whatever nesting level they like.
 *
 * The only constructor is `test`. It takes a HarnessConfig (shared across
 * tests via closures) and per-test options (name, prompt, check). It runs
 * the agent loop, checks the response, and returns a TestResult.
 *
 * The `run` combinator collects tests into a SuiteResult.
 */
import type { AiError, Tool } from 'effect/unstable/ai'
import { LanguageModel, Prompt } from 'effect/unstable/ai'
import { Effect } from 'effect'
import type { HarnessConfig } from '@agents/agent'
import { run as runHarness } from '@agents/agent'

// ---------------------------------------------------------------------------
// Test Result
// ---------------------------------------------------------------------------

export interface TestResult {
  readonly _tag: 'TestResult'
  readonly name: string
  readonly passed: boolean
  readonly response?: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
  readonly reason?: string | undefined
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

/**
 * A test is just an Effect that produces a TestResult.
 * R declares what services the test needs — the caller provides them.
 */
export type Test<R = never, E = never> = Effect.Effect<TestResult, E, R>

// ---------------------------------------------------------------------------
// Eval Options
// ---------------------------------------------------------------------------

export interface TestOptions {
  readonly name: string
  readonly prompt: string
  readonly check: (response: string) => boolean
  readonly reason?: string
}

// ---------------------------------------------------------------------------
// test — the single test constructor
// ---------------------------------------------------------------------------

/**
 * Create a test that runs the agent loop with the given config and checks
 * the response.
 *
 * The HarnessConfig determines the agent's behavior (system prompt, toolkit,
 * hooks). Share it across tests via a normal variable — that's your scoping
 * mechanism.
 *
 * The returned Effect's R includes LanguageModel plus whatever the config's
 * toolkit needs (e.g. tool handler tags → CurrentShell, CurrentFiles).
 * Provide those at whatever nesting level you like.
 *
 * Usage:
 *   const config = { systemPrompt: "...", toolkit: AgentToolkit }
 *
 *   const tests = [
 *     test(config, { name: "read-file", prompt: "...", check: r => r.includes("hello") }),
 *     test(config, { name: "count-lines", prompt: "...", check: r => r.includes("5") }),
 *   ]
 *
 *   run(tests).pipe(
 *     Effect.provide(AgentToolkitLive),
 *     Effect.provide(sandboxLayer),
 *     Effect.provide(AnthropicLive),
 *   )
 */
export const test = <
  Tools extends Record<string, Tool.Any>,
  HookE = never,
  HookR = never,
>(
  config: HarnessConfig<Tools, HookE, HookR>,
  options: TestOptions
): Test<LanguageModel.LanguageModel | HookR, AiError.AiError | HookE> =>
  Effect.gen(function* () {
    // Build the conversation from config.systemPrompt + the test prompt.
    // run() takes a complete conversation and continues it.
    const messages: Array<Prompt.MessageEncoded> = []
    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt })
    }
    messages.push({ role: 'user', content: options.prompt })
    const conversation = Prompt.make(messages)

    const result = yield* runHarness(conversation, config)
    const response = result.text

    return {
      _tag: 'TestResult' as const,
      name: options.name,
      passed: options.check(response),
      response,
      usage: result.usage,
      reason:
        options.reason ??
        (options.check(response)
          ? undefined
          : 'Response did not match criteria'),
    }
  })

// ---------------------------------------------------------------------------
// Suite Result
// ---------------------------------------------------------------------------

export interface SuiteResult {
  readonly _tag: 'SuiteResult'
  readonly results: ReadonlyArray<TestResult>
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
  }
}

// ---------------------------------------------------------------------------
// Suite Runner
// ---------------------------------------------------------------------------

export interface RunOptions {
  readonly concurrency?: number
}

/**
 * Run a collection of tests and collect results.
 */
export const run = <R, E>(
  tests: ReadonlyArray<Test<R, E>>,
  options?: RunOptions
): Effect.Effect<SuiteResult, E, R> =>
  Effect.gen(function* () {
    const concurrency = options?.concurrency ?? 1

    const results = yield* Effect.forEach(tests, (test) => test, {
      concurrency,
    })

    const passed = results.filter((r) => r.passed).length
    const failed = results.length - passed

    return {
      _tag: 'SuiteResult',
      results,
      summary: { total: results.length, passed, failed },
    }
  })
