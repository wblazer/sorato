import { Context } from 'effect'

export interface ToolDisplayFileContents {
  readonly name: string
  readonly contents: string
  readonly lang?: string | undefined
  readonly header?: string | undefined
  readonly cacheKey?: string | undefined
}

export interface ToolCallDisplay {
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
}

export type ToolResultDisplay = {
  readonly type: 'diff'
  readonly oldFile: ToolDisplayFileContents
  readonly newFile: ToolDisplayFileContents
  readonly summary: {
    readonly additions: number
    readonly deletions: number
  }
}

export interface ToolResultPresentation {
  readonly toolName: string
  readonly result: string
  readonly display?: ToolResultDisplay | undefined
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const displaySubtitle = (params: unknown): string | undefined => {
  if (!isRecord(params)) return undefined
  const path = params.path
  if (typeof path === 'string') return path
  const filePath = params.filePath
  if (typeof filePath === 'string') return filePath
  return undefined
}

export const toolCallDisplay = (
  toolName: string,
  params: unknown
): ToolCallDisplay => ({
  title: toolName,
  subtitle: displaySubtitle(params),
})

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
    display: {
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
