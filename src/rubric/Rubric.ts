/**
 * A Rubric evaluates the outcome of a harness run and produces a Score.
 *
 * Critically, a rubric does NOT just compare strings. After a full agent loop,
 * the "output" is the state of the world — files on disk, test results, git
 * state, whatever. The rubric receives a `RunContext` containing:
 *   - The Sandbox (to inspect world state: run commands, read files)
 *   - The full conversation history
 *   - The original scenario (including any expected-value data)
 *   - Aggregate usage stats
 *
 * A string-comparison rubric is just a special case that only looks at the
 * final assistant message. The library ships some of those for convenience,
 * but the real power is in rubrics that inspect the sandbox.
 *
 * Example: a coding benchmark rubric might do:
 *   sandbox.exec("bun test") → check exit code
 *   sandbox.readFile("src/foo.ts") → check the implementation
 */
import { AiError, LanguageModel } from '@effect/ai'
import type { Prompt } from '@effect/ai'
import { Effect, Schema } from 'effect'
import type { SandboxSession } from '../sandbox/Sandbox.ts'
import type { Scenario } from '../dataset/Dataset.ts'

// ---------------------------------------------------------------------------
// RunContext — what the rubric receives
// ---------------------------------------------------------------------------

/**
 * Everything a rubric might need to judge a harness run.
 *
 * Generic over the scenario types so the rubric has full access to the
 * scenario's input, expected value, and metadata.
 */
export interface RunContext<
  Input = string,
  Expected = string,
  Meta = Record<string, never>,
> {
  /** The scenario that was run. */
  readonly scenario: Scenario<Input, Expected, Meta>

  /** The full conversation history from the agent loop. */
  readonly conversation: Prompt.Prompt

  /** The Sandbox the agent ran in — inspect files, run commands, etc. */
  readonly sandbox: SandboxSession

  /** Token usage from the harness invocation. */
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/**
 * The result of evaluating a single scenario.
 *
 * `pass` is the hard boolean gate. `score` is a 0–1 float for finer-grained
 * ranking. `reason` is an optional human-readable explanation.
 */
export interface Score {
  readonly pass: boolean
  readonly score: number
  readonly reason?: string | undefined
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

/**
 * A rubric is a named evaluation function that receives a RunContext.
 *
 * Generic over:
 *   - `Input`, `Expected`, `Meta` — the scenario shape (so the rubric can
 *     access scenario.expected, scenario.metadata, etc.)
 *   - `E` — errors the evaluation can produce
 *   - `R` — Effect requirements (e.g. LanguageModel for LLM-as-judge)
 */
export interface Rubric<
  Input = string,
  Expected = string,
  Meta = Record<string, never>,
  E = never,
  R = never,
> {
  readonly name: string
  readonly evaluate: (
    ctx: RunContext<Input, Expected, Meta>
  ) => Effect.Effect<Score, E, R>
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * Create a rubric from a pure (synchronous) evaluation function.
 */
export const fromFunction = <
  Input = string,
  Expected = string,
  Meta = Record<string, never>,
>(
  name: string,
  fn: (ctx: RunContext<Input, Expected, Meta>) => Score
): Rubric<Input, Expected, Meta> => ({
  name,
  evaluate: (ctx) => Effect.sync(() => fn(ctx)),
})

/**
 * Create a rubric from an effectful evaluation function.
 * Use this when evaluation needs IO — calling an LLM, running sandbox
 * commands, reading files, etc.
 */
export const fromEffect = <Input, Expected, Meta, E, R>(
  name: string,
  evaluate: (
    ctx: RunContext<Input, Expected, Meta>
  ) => Effect.Effect<Score, E, R>
): Rubric<Input, Expected, Meta, E, R> => ({
  name,
  evaluate,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the final assistant text from a conversation. */
export const finalAssistantText = (conversation: Prompt.Prompt): string => {
  const messages = conversation.content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role === 'assistant') {
      return msg.content
        .filter((p): p is Prompt.TextPart => p.type === 'text')
        .map((p) => p.text)
        .join('')
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// Built-in rubrics (string comparison on final assistant message)
// ---------------------------------------------------------------------------

/**
 * Passes when the final assistant message === scenario.expected.
 */
export const exactMatch: Rubric<string, string> = fromFunction(
  'exact-match',
  (ctx) => {
    const output = finalAssistantText(ctx.conversation)
    return {
      pass: output === ctx.scenario.expected,
      score: output === ctx.scenario.expected ? 1 : 0,
    }
  }
)

/**
 * Passes when the final assistant message contains scenario.expected.
 */
export const contains: Rubric<string, string> = fromFunction(
  'contains',
  (ctx) => {
    const output = finalAssistantText(ctx.conversation)
    return {
      pass: output.includes(ctx.scenario.expected),
      score: output.includes(ctx.scenario.expected) ? 1 : 0,
    }
  }
)

/**
 * Passes when the final assistant message matches scenario.expected as regex.
 */
export const regex: Rubric<string, string> = fromFunction('regex', (ctx) => {
  const output = finalAssistantText(ctx.conversation)
  const re = new RegExp(ctx.scenario.expected)
  const matches = re.test(output)
  return { pass: matches, score: matches ? 1 : 0 }
})

// ---------------------------------------------------------------------------
// LLM-as-judge
// ---------------------------------------------------------------------------

/**
 * An LLM-as-judge rubric. Receives the full RunContext and asks a model
 * to evaluate the outcome.
 *
 * Requires `LanguageModel` in the Effect context.
 */
export const llmJudge = (
  criteria: string
): Rubric<
  string,
  string,
  Record<string, never>,
  AiError.AiError,
  LanguageModel.LanguageModel
> => {
  const JudgeResult = Schema.Struct({
    pass: Schema.Boolean,
    score: Schema.Number,
    reason: Schema.String,
  })

  return fromEffect('llm-judge', (ctx) =>
    Effect.gen(function* () {
      const output = finalAssistantText(ctx.conversation)

      const response = yield* LanguageModel.generateObject({
        prompt: [
          {
            role: 'system',
            content: `You are an evaluation judge. Score the assistant's output against the expected output.

Criteria: ${criteria}

Respond with:
- pass: boolean (true if the output meets the criteria)
- score: number between 0 and 1
- reason: brief explanation of your scoring`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Expected output:\n${ctx.scenario.expected}\n\nActual output:\n${output}`,
              },
            ],
          },
        ],
        schema: JudgeResult,
        objectName: 'JudgeResult',
      })

      return {
        pass: response.value.pass,
        score: response.value.score,
        reason: response.value.reason,
      } satisfies Score
    })
  )
}
