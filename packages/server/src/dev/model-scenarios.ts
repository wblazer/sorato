import { Effect, Layer } from 'effect'
import { ModelOption, ModelsResponse, ModelUnavailable } from '@sorato/api'
import type { Prompt } from 'effect/unstable/ai'
import {
  LanguageModelResolver,
  LanguageModelResolverLive,
  ModelCatalog,
  ModelCatalogLive,
  type ModelOptions,
  type ModelPurpose,
} from '../model-catalog.ts'
import {
  Scripted,
  scriptedLanguageModelLayer,
  type ScriptedPlan,
  type ScriptedStep,
} from './scripted-language-model.ts'

interface ModelScenario {
  readonly option: ModelOption
  readonly plans: Readonly<Record<ModelPurpose, ScriptedPlan>>
}

const capabilities = (reasoning: boolean) => ({
  attachment: false,
  reasoning,
  temperature: false,
  toolCall: true,
  thinkingLevels: [],
  modes: [],
  limits: { context: 128_000, output: 16_000 },
})

const option = (
  id: string,
  name: string,
  description: string,
  reasoning = false
) =>
  ModelOption.make({
    id: `scenario/${id}`,
    name,
    provider: 'Developer scenarios',
    kind: 'scenario',
    description,
    capabilities: capabilities(reasoning),
  })

const wordDeltas = (deltas: ReadonlyArray<string>): ReadonlyArray<string> =>
  deltas.flatMap((delta) => delta.match(/\S+\s*|\s+/g) ?? [])

const streamedText = (
  id: string,
  deltas: ReadonlyArray<string>,
  delay: Parameters<typeof Effect.sleep>[0] = { milliseconds: 100 }
): ReadonlyArray<ScriptedStep> => [
  Scripted.delay({ seconds: 1 }),
  Scripted.textStart(id),
  ...wordDeltas(deltas).flatMap((delta) => [
    Scripted.textDelta(id, delta),
    Scripted.delay(delay),
  ]),
  Scripted.textEnd(id),
  Scripted.finish(),
]

const streamedReasoning = (
  id: string,
  deltas: ReadonlyArray<string>,
  delay: Parameters<typeof Effect.sleep>[0] = { milliseconds: 100 }
): ReadonlyArray<ScriptedStep> => [
  Scripted.delay({ seconds: 1 }),
  Scripted.reasoningStart(id),
  ...wordDeltas(deltas).flatMap((delta) => [
    Scripted.reasoningDelta(id, delta),
    Scripted.delay(delay),
  ]),
  Scripted.reasoningEnd(id),
]

const latestUserText = (prompt: Prompt.Prompt): string => {
  for (let index = prompt.content.length - 1; index >= 0; index -= 1) {
    const message = prompt.content[index]
    if (message?.role !== 'user') continue
    const text = message.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  return 'scenario input'
}

const latestToolResult = (prompt: Prompt.Prompt): string | undefined => {
  for (let index = prompt.content.length - 1; index >= 0; index -= 1) {
    const message = prompt.content[index]
    if (message?.role !== 'tool') continue
    for (
      let partIndex = message.content.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.content[partIndex]
      if (part?.type === 'tool-result') return String(part.result)
    }
  }
  return undefined
}

const commonSummary = streamedText('summary', [
  'The scripted scenario completed deterministic work. ',
  'Preserve the selected branch, relevant tool results, ',
  'and the latest user goal for continuation.',
])

const scenarios = [
  {
    option: option(
      'streaming-markdown',
      'Streaming markdown',
      'Streams headings, lists, code, and a table in several chunks.'
    ),
    plans: {
      agent: [
        streamedText('markdown', [
          '## Scripted response\n\n',
          'This response uses the real Sorato run and SSE pipeline.\n\n',
          '- Streaming is deterministic\n- No provider credentials are used\n\n',
          '```ts\nconst source = "scripted"\n```\n\n',
          '| Path | Status |\n| --- | --- |\n| Harness | Real |\n| Inference | Scripted |',
        ]),
      ],
      summary: [commonSummary],
      title: [[Scripted.text('Streaming Markdown'), Scripted.finish()]],
    },
  },
  {
    option: option(
      'reasoning',
      'Reasoning and answer',
      'Streams a reasoning block followed by a normal answer.',
      true
    ),
    plans: {
      agent: [
        [
          ...streamedReasoning('reasoning', [
            'I am checking the scripted scenario and preparing a deterministic response.',
          ]),
          ...streamedText('answer', [
            'The reasoning and answer blocks ',
            'were streamed through the normal harness.',
          ]),
        ],
      ],
      summary: [commonSummary],
      title: [[Scripted.text('Reasoning Scenario'), Scripted.finish()]],
    },
  },
  {
    option: option(
      'tool-call',
      'Tool round trip',
      'Runs the real Glob tool, then streams a follow-up response.'
    ),
    plans: {
      agent: [
        [
          Scripted.toolCall('scenario-glob', 'Glob', {
            pattern: '**/package.json',
          }),
          Scripted.finish('tool-calls'),
        ],
        streamedText('tool-answer', [
          'The scripted model requested `Glob`. ',
          'Its real tool result is present in the transcript above.',
        ]),
      ],
      summary: [commonSummary],
      title: [[Scripted.text('Tool Call Scenario'), Scripted.finish()]],
    },
  },
  {
    option: option(
      'slow-cancellable',
      'Slow cancellable stream',
      'Pauses after the first delta so the run can be stopped mid-stream.'
    ),
    plans: {
      agent: [
        [
          Scripted.textStart('slow'),
          Scripted.textDelta('slow', 'The first chunk arrived. '),
          Scripted.delay({ seconds: 5 }),
          Scripted.textDelta('slow', 'The delayed chunk arrived.'),
          Scripted.textEnd('slow'),
          Scripted.finish(),
        ],
      ],
      summary: [commonSummary],
      title: [[Scripted.text('Cancellable Stream'), Scripted.finish()]],
    },
  },
  {
    option: option(
      'partial-error',
      'Partial response then error',
      'Streams partial output and then fails like a model provider.'
    ),
    plans: {
      agent: [
        [
          Scripted.textStart('partial'),
          Scripted.textDelta('partial', 'This output arrived before failure.'),
          Scripted.delay({ milliseconds: 250 }),
          Scripted.fail('The scripted provider failed after partial output.'),
        ],
      ],
      summary: [commonSummary],
      title: [[Scripted.text('Failure Scenario'), Scripted.finish()]],
    },
  },
  {
    option: option(
      'compaction',
      'Compaction and summary',
      'Calls CompactConversation, emits a deterministic summary, and continues.'
    ),
    plans: {
      agent: [
        (prompt) => {
          const match = latestUserText(prompt)
          return [
            Scripted.toolCall('scenario-compact', 'CompactConversation', {
              start: { type: 'message', role: 'user', match, include: true },
              end: { type: 'message', role: 'user', match, include: true },
            }),
            Scripted.finish('tool-calls'),
          ]
        },
        (prompt) => {
          const result = latestToolResult(prompt)
          return result?.includes('Compaction successful')
            ? streamedText('compact-answer', [
                'The selected range was replaced by the ',
                'scripted summary and the agent continued from that branch.',
              ])
            : streamedText('compact-answer', [
                'The scripted compaction request was not applied. ',
                result ?? 'No tool result was returned.',
              ])
        },
      ],
      summary: [
        streamedText('summary', [
          'A deterministic developer scenario compacted ',
          'the selected user request. Continue from ',
          'the scripted summary.',
        ]),
      ],
      title: [[Scripted.text('Compaction Scenario'), Scripted.finish()]],
    },
  },
] satisfies ReadonlyArray<ModelScenario>

const byId = new Map(
  scenarios.map((scenario) => [scenario.option.id, scenario])
)

const validScenarioOptions = (options: ModelOptions) =>
  (options.thinkingLevel === undefined || options.thinkingLevel === 'off') &&
  options.mode === undefined

export const DevModelCatalogLive = Layer.effect(
  ModelCatalog,
  Effect.gen(function* () {
    const base = yield* ModelCatalog

    return ModelCatalog.of({
      list: (dir) =>
        base.list(dir).pipe(
          Effect.catchTag('ProviderNotConfigured', () =>
            Effect.succeed(ModelsResponse.make({ models: [] }))
          ),
          Effect.map((result) =>
            ModelsResponse.make({
              models: [
                ...result.models,
                ...scenarios.map(({ option }) => option),
              ],
              defaultModel: result.defaultModel,
            })
          )
        ),
      ensure: (dir, model, options = {}) => {
        const scenario = byId.get(model)
        if (scenario === undefined) {
          if (!model.startsWith('scenario/'))
            return base.ensure(dir, model, options)
          return Effect.fail(
            new ModelUnavailable({
              code: 'model.unavailable',
              model,
              message: `Scenario is not available: ${model}`,
              retryable: false,
            })
          )
        }
        if (validScenarioOptions(options))
          return Effect.succeed(scenario.option)
        return Effect.fail(
          new ModelUnavailable({
            code: 'model.unavailable',
            model,
            message: `Scenario does not accept model options: ${model}`,
            retryable: false,
          })
        )
      },
    })
  })
).pipe(Layer.provide(ModelCatalogLive))

export const DevLanguageModelResolverLive = Layer.effect(
  LanguageModelResolver,
  Effect.gen(function* () {
    const base = yield* LanguageModelResolver

    return LanguageModelResolver.of({
      resolve: (dataDir, selection, purpose) => {
        const scenario = byId.get(selection.id)
        if (scenario === undefined)
          return base.resolve(dataDir, selection, purpose)

        return Effect.succeed({
          layer: scriptedLanguageModelLayer(scenario.plans[purpose]),
          attribution: {
            providerId: 'scenario',
            modelId: scenario.option.id.slice('scenario/'.length),
            billingMode: 'unbilled' as const,
            cost: undefined,
          },
        })
      },
    })
  })
).pipe(Layer.provide(LanguageModelResolverLive))
