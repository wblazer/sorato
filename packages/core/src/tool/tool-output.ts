import { Context, Option, Schema } from 'effect'

export const MessageIconNameSchema = Schema.Literals([
  'tool',
  'tool-result',
  'file-text',
  'file-plus',
  'search',
  'file-search',
  'edit',
  'terminal',
  'globe',
])
export type MessageIconName = typeof MessageIconNameSchema.Type

export const MessageHeaderDisplaySchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  subtitle: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(MessageIconNameSchema),
})
export type MessageHeaderDisplay = typeof MessageHeaderDisplaySchema.Type

const DiffSummarySchema = Schema.Struct({
  additions: Schema.Number,
  deletions: Schema.Number,
})

export const ToolResultDisplaySchema = Schema.Struct({
  type: Schema.Literal('inline-diff'),
  fileName: Schema.String,
  patch: Schema.String,
  summary: DiffSummarySchema,
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
  command: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  pattern: Schema.optionalKey(Schema.String),
  include: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.String),
})

type ToolCallHeaderParams = typeof ToolCallHeaderParams.Type

const trimToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

const compactOneLine = (value: string): string =>
  value
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim() ?? value.trim()

const preview = (value: string, maxLength = 96): string => {
  const oneLine = compactOneLine(value).replace(/\s+/g, ' ')
  if (oneLine.length <= maxLength) return oneLine
  return `${oneLine.slice(0, maxLength - 1).trimEnd()}…`
}

const fileSubtitle = ({ path, filePath }: ToolCallHeaderParams) =>
  trimToUndefined(path) ?? trimToUndefined(filePath)

const bashSubtitle = ({ command }: ToolCallHeaderParams) => {
  const trimmed = trimToUndefined(command)
  return trimmed === undefined ? undefined : preview(trimmed)
}

const globSubtitle = ({ path, pattern }: ToolCallHeaderParams) => {
  const trimmedPattern = trimToUndefined(pattern)
  if (trimmedPattern === undefined) return trimToUndefined(path)
  const trimmedPath = trimToUndefined(path)
  return trimmedPath === undefined
    ? preview(trimmedPattern)
    : preview(`${trimmedPath.replace(/\/+$/, '')}/${trimmedPattern}`)
}

const grepSubtitle = ({ path, pattern, include }: ToolCallHeaderParams) => {
  const trimmedPath = trimToUndefined(path)
  const parts = [
    trimToUndefined(pattern),
    trimToUndefined(include),
    trimmedPath === undefined ? undefined : `in ${trimmedPath}`,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? undefined : preview(parts.join(' · '))
}

const displaySubtitle = (
  toolName: string,
  params: unknown
): string | undefined => {
  const parsed = Schema.decodeUnknownOption(ToolCallHeaderParams)(params)
  return Option.match(parsed, {
    onNone: () => undefined,
    onSome: (params) => {
      switch (toolName.toLowerCase()) {
        case 'bash':
          return bashSubtitle(params)
        case 'glob':
          return globSubtitle(params)
        case 'grep':
          return grepSubtitle(params)
        case 'webfetch':
          return trimToUndefined(params.url)
        default:
          return fileSubtitle(params)
      }
    },
  })
}

const toolIcons: Partial<Record<string, MessageIconName>> = {
  read: 'file-text',
  write: 'file-plus',
  edit: 'edit',
  bash: 'terminal',
  glob: 'file-search',
  grep: 'search',
  webfetch: 'globe',
}

const toolIcon = (toolName: string): MessageIconName | undefined =>
  toolIcons[toolName.toLowerCase()]

export const toolCallHeader = (
  toolName: string,
  params: unknown
): MessageHeaderDisplay => {
  const subtitle = displaySubtitle(toolName, params)
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
  const oldLines =
    options.oldContent.length === 0 ? [] : options.oldContent.split('\n')
  const newLines =
    options.newContent.length === 0 ? [] : options.newContent.split('\n')
  const summary = diffStats(options.oldContent, options.newContent)
  registry.push({
    toolName: options.toolName,
    result: options.result,
    bodyDisplay: {
      type: 'inline-diff',
      fileName: options.path,
      patch: patchFromLines(options.path, [
        {
          oldStart: oldLines.length === 0 ? 0 : 1,
          newStart: newLines.length === 0 ? 0 : 1,
          lines: [
            ...oldLines.map((content) => ({
              type: 'delete' as const,
              content,
            })),
            ...newLines.map((content) => ({ type: 'add' as const, content })),
          ],
        },
      ]),
      summary,
    },
  })
}

export interface InlineDiffHunkLine {
  readonly type: 'add' | 'delete' | 'context'
  readonly content: string
}

export interface InlineDiffHunk {
  readonly oldStart: number
  readonly newStart: number
  readonly lines: ReadonlyArray<InlineDiffHunkLine>
}

export const patchFromLines = (
  path: string,
  hunks: ReadonlyArray<InlineDiffHunk>
): string => {
  const lines = [`--- ${path}\t`, `+++ ${path}\t`]
  for (const hunk of hunks) {
    const oldCount = hunk.lines.filter((line) => line.type !== 'add').length
    const newCount = hunk.lines.filter((line) => line.type !== 'delete').length
    lines.push(
      `@@ -${range(hunk.oldStart, oldCount)} +${range(hunk.newStart, newCount)} @@`
    )
    for (const line of hunk.lines) {
      lines.push(`${linePrefix(line.type)}${line.content}`)
    }
  }
  return `${lines.join('\n')}\n`
}

const range = (start: number, count: number) => {
  if (count === 0) return `${Math.max(0, start)},0`
  if (count === 1) return `${start}`
  return `${start},${count}`
}

const linePrefix = (type: InlineDiffHunkLine['type']) => {
  switch (type) {
    case 'add':
      return '+'
    case 'delete':
      return '-'
    case 'context':
      return ' '
  }
}
