/**
 * Built-in rubrics — string comparison on final assistant message,
 * plus LLM-as-judge.
 */
import { AiError, LanguageModel } from '@effect/ai'
import { Effect, Schema } from 'effect'
import {
  type Rubric,
  type Score,
  fromFunction,
  fromEffect,
  finalAssistantText,
} from './Rubric.ts'

// ---------------------------------------------------------------------------
// Built-in rubrics (string comparison on final assistant message)
// ---------------------------------------------------------------------------

/**
 * Scores 1 when the final assistant message === the expected string.
 * Generic over Input/Meta — these rubrics only inspect the conversation,
 * not the scenario input, so they work with any scenario shape.
 */
export const exactMatch = <Input = string, Meta = Record<string, never>>(
  expected: string
): Rubric<Input, Meta> =>
  fromFunction<Input, Meta>(
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
export const contains = <Input = string, Meta = Record<string, never>>(
  expected: string
): Rubric<Input, Meta> =>
  fromFunction<Input, Meta>(
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
export const regex = <Input = string, Meta = Record<string, never>>(
  pattern: string
): Rubric<Input, Meta> =>
  fromFunction<Input, Meta>(
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
