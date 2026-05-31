import { Context, Option, Schema } from 'effect'

export const ToolDisplayFileContentsSchema = Schema.Struct({
  name: Schema.String,
  contents: Schema.String,
  lang: Schema.optionalKey(Schema.String),
  header: Schema.optionalKey(Schema.String),
  cacheKey: Schema.optionalKey(Schema.String),
})
export type ToolDisplayFileContents = typeof ToolDisplayFileContentsSchema.Type

export const MessageIconNameSchema = Schema.Literals([
  'tool',
  'tool-result',
  'file-text',
  'file-plus',
  'search',
  'file-search',
  'edit',
  'terminal',
])
export type MessageIconName = typeof MessageIconNameSchema.Type

export const MessageHeaderDisplaySchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  subtitle: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(MessageIconNameSchema),
})
export type MessageHeaderDisplay = typeof MessageHeaderDisplaySchema.Type

export const ToolResultDisplaySchema = Schema.Struct({
  type: Schema.Literal('diff'),
  oldFile: ToolDisplayFileContentsSchema,
  newFile: ToolDisplayFileContentsSchema,
  summary: Schema.Struct({
    additions: Schema.Number,
    deletions: Schema.Number,
  }),
})
export type ToolResultDisplay = typeof ToolResultDisplaySchema.Type

export interface ToolResultPresentation {
  readonly toolName: string
  readonly result: string
  readonly bodyDisplay?: ToolResultDisplay | undefined
}

export interface ToolOutputRegistryApi {
  readonly push: (presentation: ToolResultPresentation) => void
  readonly take: (
    toolName: string,
    result: string
  ) => ToolResultPresentation | undefined
}

const makeRegistry = (): ToolOutputRegistryApi => {
  const presentations: ToolResultPresentation[] = []

  return {
    push: (presentation) => {
      presentations.push(presentation)
    },
    take: (toolName, result) => {
      const index = presentations.findIndex(
        (presentation) =>
          presentation.toolName === toolName && presentation.result === result
      )
      if (index === -1) return undefined
      const [presentation] = presentations.splice(index, 1)
      return presentation
    },
  }
}

export const ToolOutputRegistry = Context.Reference<ToolOutputRegistryApi>(
  '@sorato/ToolOutputRegistry',
  { defaultValue: makeRegistry }
)

export const diffStats = (oldContent: string, newContent: string) => {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++
  }

  let oldSuffix = oldLines.length - 1
  let newSuffix = newLines.length - 1
  while (
    oldSuffix >= prefix &&
    newSuffix >= prefix &&
    oldLines[oldSuffix] === newLines[newSuffix]
  ) {
    oldSuffix--
    newSuffix--
  }

  return {
    additions: Math.max(0, newSuffix - prefix + 1),
    deletions: Math.max(0, oldSuffix - prefix + 1),
  }
}

const ToolCallHeaderParams = Schema.Struct({
  path: Schema.optionalKey(Schema.String),
  filePath: Schema.optionalKey(Schema.String),
})

const displaySubtitle = (params: unknown): string | undefined => {
  const parsed = Schema.decodeUnknownOption(ToolCallHeaderParams)(params)
  return Option.match(parsed, {
    onNone: () => undefined,
    onSome: ({ path, filePath }) => path ?? filePath,
  })
}

const toolIcon = (toolName: string): MessageIconName | undefined => {
  switch (toolName.toLowerCase()) {
    case 'read':
      return 'file-text'
    case 'write':
      return 'file-plus'
    case 'edit':
      return 'edit'
    case 'bash':
      return 'terminal'
    case 'glob':
      return 'file-search'
    case 'grep':
      return 'search'
  }
}

export const toolCallHeader = (
  toolName: string,
  params: unknown
): MessageHeaderDisplay => {
  const subtitle = displaySubtitle(params)
  const icon = toolIcon(toolName)
  return {
    title: toolName,
    ...(icon !== undefined ? { icon } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
  }
}

export const recordFileDiffPresentation = (
  registry: ToolOutputRegistryApi,
  options: {
    readonly toolName: string
    readonly path: string
    readonly oldContent: string
    readonly newContent: string
    readonly result: string
  }
) => {
  const summary = diffStats(options.oldContent, options.newContent)
  registry.push({
    toolName: options.toolName,
    result: options.result,
    bodyDisplay: {
      type: 'diff',
      oldFile: {
        name: options.path,
        contents: options.oldContent,
      },
      newFile: {
        name: options.path,
        contents: options.newContent,
      },
      summary,
    },
  })
}
