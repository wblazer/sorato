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
export const ResolvedToolBlockExpansionSchema = Schema.Struct({
  default: Schema.Boolean,
  tools: Schema.Record(Schema.String, Schema.Boolean),
})
export type ResolvedToolBlockExpansion =
  typeof ResolvedToolBlockExpansionSchema.Type
export const ClientConfigSchema = Schema.Struct({
  expand_tool_blocks_by_default: Schema.optional(Schema.Boolean),
  tool_block_expansion: Schema.optional(ToolBlockExpansionSchema),
  transcript_display_mode: Schema.optional(TranscriptDisplayModeSchema),
  expand_system_messages_by_default: Schema.optional(Schema.Boolean),
})
export type ClientConfig = typeof ClientConfigSchema.Type
export type ResolvedClientConfigValue = {
  readonly expand_tool_blocks_by_default: boolean
  readonly tool_block_expansion: ResolvedToolBlockExpansion
  readonly transcript_display_mode: TranscriptDisplayMode
  readonly expand_system_messages_by_default: boolean
}
export interface ResolvedClientConfig {
  readonly defaults: ResolvedClientConfigValue
  readonly file: ClientConfig
  readonly overrides: ClientConfig
  readonly resolved: ResolvedClientConfigValue
  readonly paths: { readonly file?: string; readonly overrides?: string }
}

export const defaultClientConfig = (): ResolvedClientConfigValue => ({
  expand_tool_blocks_by_default: false,
  tool_block_expansion: { default: false, tools: { Edit: true, Write: true } },
  transcript_display_mode: 'pretty',
  expand_system_messages_by_default: false,
})

export const mergeClientConfig = <T extends ResolvedClientConfigValue>(
  base: T,
  override: ClientConfig
): T => {
  const legacy = override.expand_tool_blocks_by_default
  const requested =
    legacy === undefined
      ? override.tool_block_expansion
      : {
          ...override.tool_block_expansion,
          default: override.tool_block_expansion?.default ?? legacy,
        }
  const tools = { ...base.tool_block_expansion.tools }
  for (const [name, value] of Object.entries(requested?.tools ?? {}))
    if (value === null) delete tools[name]
    else tools[name] = value
  return {
    ...base,
    ...(legacy === undefined ? {} : { expand_tool_blocks_by_default: legacy }),
    ...(requested === undefined
      ? {}
      : {
          tool_block_expansion: {
            default: requested.default ?? base.tool_block_expansion.default,
            tools,
          },
        }),
    ...(override.transcript_display_mode === undefined
      ? {}
      : { transcript_display_mode: override.transcript_display_mode }),
    ...(override.expand_system_messages_by_default === undefined
      ? {}
      : {
          expand_system_messages_by_default:
            override.expand_system_messages_by_default,
        }),
  }
}

export const resolveClientConfig = (
  file: ClientConfig = {},
  overrides: ClientConfig = {}
): ResolvedClientConfig => {
  const defaults = defaultClientConfig()
  return {
    defaults,
    file,
    overrides,
    resolved: mergeClientConfig(mergeClientConfig(defaults, file), overrides),
    paths: {},
  }
}

export const diffClientConfig = (
  base: ResolvedClientConfigValue,
  value: ResolvedClientConfigValue
): ClientConfig => {
  const tools: Record<string, boolean | null> = {}
  for (const name of new Set([
    ...Object.keys(base.tool_block_expansion.tools),
    ...Object.keys(value.tool_block_expansion.tools),
  ])) {
    if (!Object.hasOwn(value.tool_block_expansion.tools, name))
      tools[name] = null
    else if (
      base.tool_block_expansion.tools[name] !==
      value.tool_block_expansion.tools[name]
    )
      tools[name] = value.tool_block_expansion.tools[name] ?? false
  }
  const defaultChanged =
    base.tool_block_expansion.default !== value.tool_block_expansion.default
  return {
    ...(defaultChanged || Object.keys(tools).length > 0
      ? {
          tool_block_expansion: {
            ...(defaultChanged
              ? { default: value.tool_block_expansion.default }
              : {}),
            ...(Object.keys(tools).length > 0 ? { tools } : {}),
          },
        }
      : {}),
    ...(base.transcript_display_mode === value.transcript_display_mode
      ? {}
      : { transcript_display_mode: value.transcript_display_mode }),
    ...(base.expand_system_messages_by_default ===
    value.expand_system_messages_by_default
      ? {}
      : {
          expand_system_messages_by_default:
            value.expand_system_messages_by_default,
        }),
  }
}

export const shouldExpandToolBlock = (
  expansion: ResolvedToolBlockExpansion,
  toolName: string
): boolean => expansion.tools[toolName] ?? expansion.default
export const encodeClientConfig = (config: ClientConfig): string =>
  `${JSON.stringify(Schema.encodeUnknownSync(ClientConfigSchema)(config), null, 2)}\n`

export const ClientSettingsSchema = Schema.Struct({
  transcriptDisplayMode: TranscriptDisplayModeSchema,
  toolBlockExpansion: ResolvedToolBlockExpansionSchema,
  expandSystemMessagesByDefault: Schema.Boolean,
})
export type ClientSettings = typeof ClientSettingsSchema.Type
export const defaultClientSettings = (): ClientSettings => ({
  transcriptDisplayMode: 'pretty',
  toolBlockExpansion: { default: false, tools: { Edit: true, Write: true } },
  expandSystemMessagesByDefault: false,
})
export const mirrorResolvedClientConfig = (
  resolved: ResolvedClientConfigValue
): ClientSettings => ({
  transcriptDisplayMode: resolved.transcript_display_mode,
  toolBlockExpansion: resolved.tool_block_expansion,
  expandSystemMessagesByDefault: resolved.expand_system_messages_by_default,
})
