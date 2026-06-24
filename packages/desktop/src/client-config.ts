import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Schema } from 'effect'

export const TranscriptDisplayModeSchema = Schema.Literals(['pretty', 'raw'])
export type TranscriptDisplayMode = typeof TranscriptDisplayModeSchema.Type

export const ToolExpansionOverrideSchema = Schema.NullOr(Schema.Boolean)

export const ToolBlockExpansionSchema = Schema.Struct({
  default: Schema.optional(Schema.Boolean),
  tools: Schema.optional(
    Schema.Record(Schema.String, ToolExpansionOverrideSchema)
  ),
})
export type ToolBlockExpansion = typeof ToolBlockExpansionSchema.Type

export interface ResolvedToolBlockExpansion {
  readonly default: boolean
  readonly tools: Record<string, boolean>
}

export const ClientConfigSchema = Schema.Struct({
  expand_tool_blocks_by_default: Schema.optional(Schema.Boolean),
  tool_block_expansion: Schema.optional(ToolBlockExpansionSchema),
  transcript_display_mode: Schema.optional(TranscriptDisplayModeSchema),
})

export type ClientConfig = typeof ClientConfigSchema.Type
export type ClientConfigOverride = ClientConfig

export interface ResolvedClientConfigValue {
  readonly expand_tool_blocks_by_default: boolean
  readonly tool_block_expansion: ResolvedToolBlockExpansion
  readonly transcript_display_mode: TranscriptDisplayMode
}

export interface ResolvedClientConfig {
  readonly defaults: ResolvedClientConfigValue
  readonly file: ClientConfig
  readonly overrides: ClientConfigOverride
  readonly resolved: ResolvedClientConfigValue
  readonly paths: {
    readonly file: string
    readonly overrides: string
  }
}

const defaultClientConfig = (): ResolvedClientConfigValue => ({
  expand_tool_blocks_by_default: false,
  tool_block_expansion: { default: false, tools: { Edit: true, Write: true } },
  transcript_display_mode: 'pretty',
})

const configRoot = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'sorato')

export const clientConfigFilePath = () =>
  process.env.SORATO_CLIENT_CONFIG?.trim() || join(configRoot(), 'client.jsonc')

export const clientOverrideFilePath = () =>
  join(app.getPath('userData'), 'client-overrides.json')

const charAt = (text: string, index: number) => text[index] ?? ''

const stripComments = (text: string) => {
  let out = ''
  let mode: 'code' | 'string' | 'line' | 'block' = 'code'

  for (let i = 0; i < text.length; i++) {
    const cur = charAt(text, i)
    const next = charAt(text, i + 1)

    switch (mode) {
      case 'string': {
        out += cur
        const escaped = Number(cur === '\\' && next !== '')
        out += next.repeat(escaped)
        i += escaped
        if (escaped === 1) continue
        mode = ['string', 'code'][Number(cur === '"')] as 'string' | 'code'
        continue
      }
      case 'line': {
        const isNewline = Number(cur === '\n')
        out += cur.repeat(isNewline)
        mode = ['line', 'code'][isNewline] as 'line' | 'code'
        continue
      }
      case 'block': {
        const isBlockEnd = Number(cur === '*' && next === '/')
        i += isBlockEnd
        mode = ['block', 'code'][isBlockEnd] as 'block' | 'code'
        continue
      }
      case 'code': {
        const isQuote = Number(cur === '"')
        out += cur.repeat(isQuote)
        mode = ['code', 'string'][isQuote] as 'code' | 'string'
        if (isQuote === 1) continue

        const lineCommentStart = Number(cur === '/' && next === '/')
        i += lineCommentStart
        mode = ['code', 'line'][lineCommentStart] as 'code' | 'line'
        if (lineCommentStart === 1) continue

        const blockCommentStart = Number(cur === '/' && next === '*')
        i += blockCommentStart
        mode = ['code', 'block'][blockCommentStart] as 'code' | 'block'
        if (blockCommentStart === 1) continue

        out += cur
      }
    }
  }

  return out
}

const stripTrailingCommas = (text: string) => {
  let out = ''
  let mode: 'code' | 'string' = 'code'

  for (let i = 0; i < text.length; i++) {
    const cur = charAt(text, i)

    switch (mode) {
      case 'string': {
        out += cur
        const escaped = Number(cur === '\\' && i + 1 < text.length)
        out += charAt(text, i + 1).repeat(escaped)
        i += escaped
        if (escaped === 1) continue
        mode = ['string', 'code'][Number(cur === '"')] as 'string' | 'code'
        continue
      }
      case 'code': {
        const isQuote = Number(cur === '"')
        out += cur.repeat(isQuote)
        mode = ['code', 'string'][isQuote] as 'code' | 'string'
        if (isQuote === 1) continue

        const isComma = Number(cur === ',')
        let j = i + isComma
        while (j < text.length && isComma === 1 && /\s/.test(charAt(text, j))) {
          j += 1
        }
        const next = charAt(text, j)
        const shouldSkipTrailingComma = Number(
          isComma === 1 && (next === '}' || next === ']')
        )

        out += cur.repeat(1 - shouldSkipTrailingComma)
      }
    }
  }

  return out
}

const readOptionalFile = async (path: string) => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }
    throw error
  }
}

const parseClientConfig = (text: string, path: string): ClientConfig => {
  try {
    return Schema.decodeUnknownSync(ClientConfigSchema)(
      JSON.parse(stripTrailingCommas(stripComments(text)))
    )
  } catch {
    throw new Error(`Failed to parse client config: ${path}`)
  }
}

const loadClientConfigFile = async (path: string): Promise<ClientConfig> => {
  const text = await readOptionalFile(path)
  return text === undefined ? {} : parseClientConfig(text, path)
}

const mergeToolBlockExpansion = (
  base: ResolvedToolBlockExpansion,
  override?: ToolBlockExpansion
): ResolvedToolBlockExpansion => {
  const tools = { ...base.tools }
  for (const [name, value] of Object.entries(override?.tools ?? {})) {
    if (value === null) {
      delete tools[name]
    } else {
      tools[name] = value
    }
  }

  return {
    default: override?.default ?? base.default,
    tools,
  }
}

const mergeClientConfig = <TBase extends ResolvedClientConfigValue>(
  base: TBase,
  override: ClientConfig
): TBase => {
  const legacyDefault = override.expand_tool_blocks_by_default
  const toolOverride =
    legacyDefault === undefined
      ? override.tool_block_expansion
      : {
          ...override.tool_block_expansion,
          default: override.tool_block_expansion?.default ?? legacyDefault,
        }

  return {
    ...base,
    ...(legacyDefault === undefined
      ? {}
      : { expand_tool_blocks_by_default: legacyDefault }),
    ...(toolOverride === undefined
      ? {}
      : {
          tool_block_expansion: mergeToolBlockExpansion(
            base.tool_block_expansion,
            toolOverride
          ),
        }),
    ...(override.transcript_display_mode === undefined
      ? {}
      : { transcript_display_mode: override.transcript_display_mode }),
  }
}

const writeJsonFile = async (path: string, value: ClientConfig) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export const loadResolvedClientConfig =
  async (): Promise<ResolvedClientConfig> => {
    const defaults = defaultClientConfig()
    const filePath = clientConfigFilePath()
    const overridesPath = clientOverrideFilePath()
    const file = await loadClientConfigFile(filePath)
    const overrides = await loadClientConfigFile(overridesPath)
    return {
      defaults,
      file,
      overrides,
      resolved: mergeClientConfig(mergeClientConfig(defaults, file), overrides),
      paths: {
        file: filePath,
        overrides: overridesPath,
      },
    }
  }

export const saveClientConfigOverrides = async (
  overrides: ClientConfigOverride
): Promise<ResolvedClientConfig> => {
  Schema.decodeUnknownSync(ClientConfigSchema)(overrides)
  await writeJsonFile(clientOverrideFilePath(), overrides)
  return loadResolvedClientConfig()
}
