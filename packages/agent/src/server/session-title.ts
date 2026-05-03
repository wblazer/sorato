import { Effect, Layer, Stream } from 'effect'
import { Chat, LanguageModel, Prompt, type Response } from 'effect/unstable/ai'
import { listModels, modelLayer } from './model-catalog.ts'
import { RuntimeConfigService } from './runtime-config.ts'

const MAX_INPUT_CHARS = 2000
const MAX_TITLE_CHARS = 100

const defaultTitleModels = [
  'anthropic/claude-haiku-4-5',
  'openai/gpt-5-nano',
] as const

const TITLE_SYSTEM_PROMPT =
  'Generate a concise title for the user request. Return only the title, no quotes, no punctuation, no explanations. Use 2-6 words.'

const cleanTitle = (text: string) => {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^['"]|['"]$/g, '')
    .replace(/[.!?]$/, '')

  if (!cleaned) return null

  return cleaned.length > MAX_TITLE_CHARS
    ? `${cleaned.slice(0, MAX_TITLE_CHARS - 3)}...`
    : cleaned
}

const selectTitleModel = Effect.fn('SessionTitle.selectModel')(function* (
  dir: string
) {
  const runtimeConfig = yield* RuntimeConfigService
  const cfg = yield* runtimeConfig.get(dir)
  const models = yield* listModels(dir)
  const available = new Set(models.models.map((model) => model.id))
  if (cfg.title_model && available.has(cfg.title_model)) return cfg.title_model

  return defaultTitleModels.find((model) => available.has(model)) ?? null
})

const generateWithModel = Effect.fn('SessionTitle.generateWithModel')(
  function* (model: string, input: string) {
    const services = modelLayer({ id: model, thinkingLevel: 'off' })
    if (!services) return null

    const truncatedInput =
      input.length > MAX_INPUT_CHARS
        ? `${input.slice(0, MAX_INPUT_CHARS)}...`
        : input
    const chat = yield* Chat.fromPrompt(
      Prompt.make([
        { role: 'system' as const, content: TITLE_SYSTEM_PROMPT },
        {
          role: 'user' as const,
          content: `<user-message>\n${truncatedInput}\n</user-message>`,
        },
      ])
    )

    const text = yield* chat.streamText({ prompt: [] }).pipe(
      Stream.filter(
        (
          part
        ): part is Extract<Response.StreamPart<{}>, { type: 'text-delta' }> =>
          part.type === 'text-delta'
      ),
      Stream.map((part) => part.delta),
      Stream.mkString,
      Effect.provide(
        services as Layer.Layer<LanguageModel.LanguageModel, never, never>
      )
    )

    return cleanTitle(text)
  }
)

export const generateSessionTitle = Effect.fn('SessionTitle.generate')(
  function* (dir: string, input: string) {
    const model = yield* selectTitleModel(dir)
    if (!model) return null

    return yield* generateWithModel(model, input).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug('Session title generation failed', { model, cause }).pipe(
          Effect.as(null)
        )
      )
    )
  }
)
