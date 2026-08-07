import { Option, Schema } from 'effect'

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

const ToolResultErrorLikeSchema = Schema.Struct({
  message: Schema.String,
  operation: Schema.optionalKey(Schema.String),
})

const decodeToolResultErrorLike = Schema.decodeUnknownOption(
  ToolResultErrorLikeSchema
)

const safeJsonStringify = (value: unknown): string | undefined => {
  try {
    return JSON.stringify(value, null, 2) ?? undefined
  } catch {
    return undefined
  }
}

export const stringifyToolResult = (result: unknown): string => {
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result)
  }

  const errorLike = decodeToolResultErrorLike(result)
  if (Option.isSome(errorLike)) {
    const { message, operation } = errorLike.value
    return operation === undefined ? message : `${operation} failed: ${message}`
  }

  return safeJsonStringify(result) ?? String(result)
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
