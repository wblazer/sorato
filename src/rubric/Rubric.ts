/**
 * A Rubric evaluates the outcome of a harness run and produces a Score.
 *
 * Critically, a rubric does NOT just compare strings. After a full agent loop,
 * the "output" is the state of the world — files on disk, test results, git
 * state, whatever. The rubric receives a `RunContext` containing:
 *   - The Sandbox (to inspect world state: run commands, read files)
 *   - The full conversation history
 *   - The original scenario
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
 * scenario's input and metadata.
 */
export interface RunContext<Input = string, Meta = Record<string, never>> {
  /** The scenario that was run. */
  readonly scenario: Scenario<Input, Meta>

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
 * The library imposes no scale — a rubric can return 0/1 for binary
 * judgments, 0–100 for percentage scores, or anything else. Interpretation
 * is the consumer's responsibility.
 */
export interface Score {
  readonly score: number
  readonly reason?: string | undefined
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

/**
 * A rubric is a named evaluation function that receives a RunContext.
 *
 * Rubrics live on individual scenarios — different scenarios in the same
 * dataset can use entirely different rubrics.
 *
 * Generic over:
 *   - `Input`, `Meta` — the scenario shape
 *   - `E` — errors the evaluation can produce
 *   - `R` — Effect requirements (e.g. LanguageModel for LLM-as-judge)
 */
export interface Rubric<
  Input = string,
  Meta = Record<string, never>,
  E = never,
  R = never,
> {
  readonly name: string
  /** Human-readable description of what the rubric checks, e.g. "contains 'Hello, World!'" */
  readonly description: string
  readonly evaluate: (
    ctx: RunContext<Input, Meta>
  ) => Effect.Effect<Score, E, R>
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * Create a rubric from a pure (synchronous) evaluation function.
 */
export const fromFunction = <Input = string, Meta = Record<string, never>>(
  name: string,
  fn: (ctx: RunContext<Input, Meta>) => Score,
  description?: string
): Rubric<Input, Meta> => ({
  name,
  description: description ?? name,
  evaluate: (ctx) => Effect.sync(() => fn(ctx)),
})

/**
 * Create a rubric from an effectful evaluation function.
 * Use this when evaluation needs IO — calling an LLM, running sandbox
 * commands, reading files, etc.
 */
export const fromEffect = <Input, Meta, E, R>(
  name: string,
  evaluate: (ctx: RunContext<Input, Meta>) => Effect.Effect<Score, E, R>,
  description?: string
): Rubric<Input, Meta, E, R> => ({
  name,
  description: description ?? name,
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
 * Scores 1 when the final assistant message === the expected string.
 */
export const exactMatch = (expected: string): Rubric =>
  fromFunction(
    'exact-match',
    (ctx) => {
      const output = finalAssistantText(ctx.conversation)
      return { score: output === expected ? 1 : 0 }
    },
    `exact match: '${expected}'`
  )

/**
 * Scores 1 when the final assistant message contains the expected string.
 */
export const contains = (expected: string): Rubric =>
  fromFunction(
    'contains',
    (ctx) => {
      const output = finalAssistantText(ctx.conversation)
      return { score: output.includes(expected) ? 1 : 0 }
    },
    `contains '${expected}'`
  )

/**
 * Scores 1 when the final assistant message matches the given regex pattern.
 */
export const regex = (pattern: string): Rubric =>
  fromFunction(
    'regex',
    (ctx) => {
      const output = finalAssistantText(ctx.conversation)
      return { score: new RegExp(pattern).test(output) ? 1 : 0 }
    },
    `matches /${pattern}/`
  )

// ---------------------------------------------------------------------------
// LLM-as-judge
// ---------------------------------------------------------------------------

/**
 * An LLM-as-judge rubric. Asks a model to evaluate the outcome against
 * the given criteria.
 *
 * Requires `LanguageModel` in the Effect context.
 */
export const llmJudge = (
  criteria: string,
  expected?: string
): Rubric<
  string,
  Record<string, never>,
  AiError.AiError,
  LanguageModel.LanguageModel
> => {
  const JudgeResult = Schema.Struct({
    score: Schema.Number,
    reason: Schema.String,
  })

  return fromEffect(
    'llm-judge',
    (ctx) =>
      Effect.gen(function* () {
        const output = finalAssistantText(ctx.conversation)

        const expectedSection = expected
          ? `\nExpected output:\n${expected}\n`
          : ''

        const response = yield* LanguageModel.generateObject({
          prompt: [
            {
              role: 'system',
              content: `You are an evaluation judge. Score the assistant's output.

Criteria: ${criteria}

Respond with:
- score: number between 0 and 1
- reason: brief explanation of your scoring`,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `${expectedSection}Actual output:\n${output}`,
                },
              ],
            },
          ],
          schema: JudgeResult,
          objectName: 'JudgeResult',
        })

        return {
          score: response.value.score,
          reason: response.value.reason,
        } satisfies Score
      }),
    `llm-judge: ${criteria}`
  )
}
