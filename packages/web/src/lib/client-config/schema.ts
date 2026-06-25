import { Schema } from 'effect'

export const TranscriptDisplayModeSchema = Schema.Literals(['pretty', 'raw'])
export type TranscriptDisplayMode = typeof TranscriptDisplayModeSchema.Type

export const ToolExpansionOverrideSchema = Schema.NullOr(Schema.Boolean)
export type ToolExpansionOverride = typeof ToolExpansionOverrideSchema.Type

export const ToolBlockExpansionSchema = Schema.Struct({
  default: Schema.optional(Schema.Boolean),
  /** null removes an inherited per-tool preference and falls back to default. */
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
  /** Deprecated: use tool_block_expansion.default. Kept for config migration. */
  expand_tool_blocks_by_default: Schema.optional(Schema.Boolean),
  tool_block_expansion: Schema.optional(ToolBlockExpansionSchema),
  transcript_display_mode: Schema.optional(TranscriptDisplayModeSchema),
  expand_system_messages_by_default: Schema.optional(Schema.Boolean),
})

export type ClientConfig = typeof ClientConfigSchema.Type

export interface ResolvedClientConfig {
  readonly defaults: Required<Omit<ClientConfig, 'tool_block_expansion'>> & {
    readonly tool_block_expansion: ResolvedToolBlockExpansion
  }
  readonly file: ClientConfig
  readonly overrides: ClientConfig
  readonly resolved: Required<Omit<ClientConfig, 'tool_block_expansion'>> & {
    readonly tool_block_expansion: ResolvedToolBlockExpansion
  }
  readonly paths: {
    readonly file?: string
    readonly overrides?: string
  }
}

export type ResolvedClientConfigValue = ResolvedClientConfig['resolved']

const defaultToolBlockExpansion = (): ResolvedToolBlockExpansion => ({
  default: false,
  tools: { Edit: true, Write: true },
})

export const defaultClientConfig = (): ResolvedClientConfigValue => ({
  expand_tool_blocks_by_default: false,
  tool_block_expansion: defaultToolBlockExpansion(),
  transcript_display_mode: 'pretty',
  expand_system_messages_by_default: false,
})

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

export const mergeClientConfig = <TBase extends ResolvedClientConfigValue>(
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
    ...(override.expand_system_messages_by_default === undefined
      ? {}
      : {
          expand_system_messages_by_default:
            override.expand_system_messages_by_default,
        }),
  }
}

const diffToolMap = (
  base: Record<string, boolean>,
  value: Record<string, boolean>
): Record<string, boolean | null> => {
  const diff: Record<string, boolean | null> = {}
  const names = new Set([...Object.keys(base), ...Object.keys(value)])
  for (const name of names) {
    if (!Object.hasOwn(value, name)) {
      diff[name] = null
    } else if (base[name] !== value[name]) {
      diff[name] = value[name]
    }
  }
  return diff
}

export const diffClientConfig = (
  base: ResolvedClientConfigValue,
  value: ResolvedClientConfigValue
): ClientConfig => {
  const toolDiff = diffToolMap(
    base.tool_block_expansion.tools,
    value.tool_block_expansion.tools
  )
  const hasToolDiff = Object.keys(toolDiff).length > 0
  const hasDefaultDiff =
    value.tool_block_expansion.default !== base.tool_block_expansion.default

  return {
    ...(hasDefaultDiff || hasToolDiff
      ? {
          tool_block_expansion: {
            ...(hasDefaultDiff
              ? { default: value.tool_block_expansion.default }
              : {}),
            ...(hasToolDiff ? { tools: toolDiff } : {}),
          },
        }
      : {}),
    ...(value.transcript_display_mode === base.transcript_display_mode
      ? {}
      : { transcript_display_mode: value.transcript_display_mode }),
    ...(value.expand_system_messages_by_default ===
    base.expand_system_messages_by_default
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
