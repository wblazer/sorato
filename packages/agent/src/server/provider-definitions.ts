import {
  Generated as AnthropicGenerated,
  type AnthropicLanguageModel,
} from '@effect/ai-anthropic'
import {
  Generated as OpenAiGenerated,
  type OpenAiLanguageModel,
} from '@effect/ai-openai'
import type * as AST from 'effect/SchemaAST'

const schemaLiterals = (ast: AST.AST): ReadonlyArray<string> => {
  switch (ast._tag) {
    case 'Literal':
      return typeof ast.literal === 'string' ? [ast.literal] : []
    case 'Union':
      return ast.types.flatMap(schemaLiterals)
    default:
      return []
  }
}

type ProviderDefinition<Model extends string = string> = {
  readonly id: string
  readonly supportedModels: ReadonlySet<Model>
}

const defineProvider = <const Id extends string, const Model extends string>(
  id: Id,
  supportedModels: ReadonlySet<Model>
): ProviderDefinition<Model> & { readonly id: Id } => ({
  id,
  supportedModels,
})

export const PROVIDER_DEFINITIONS = {
  anthropic: defineProvider(
    'anthropic',
    new Set<AnthropicLanguageModel.Model>(
      schemaLiterals(
        AnthropicGenerated.Model.ast
      ) as ReadonlyArray<AnthropicLanguageModel.Model>
    )
  ),
  openai: defineProvider(
    'openai',
    new Set<OpenAiLanguageModel.Model>([
      ...schemaLiterals(OpenAiGenerated.ModelIdsResponses.ast),
      ...schemaLiterals(OpenAiGenerated.ModelIdsShared.ast),
    ] as ReadonlyArray<OpenAiLanguageModel.Model>)
  ),
} as const

export type ProviderId = keyof typeof PROVIDER_DEFINITIONS

export const SUPPORTED_PROVIDERS = Object.values(PROVIDER_DEFINITIONS)
