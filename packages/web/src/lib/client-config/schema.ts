import { Schema } from 'effect'

export const TranscriptDisplayModeSchema = Schema.Literals(['pretty', 'raw'])
export type TranscriptDisplayMode = typeof TranscriptDisplayModeSchema.Type

export const ClientConfigSchema = Schema.Struct({
  expand_tool_blocks_by_default: Schema.optional(Schema.Boolean),
  transcript_display_mode: Schema.optional(TranscriptDisplayModeSchema),
})

export type ClientConfig = typeof ClientConfigSchema.Type

export interface ResolvedClientConfig {
  readonly defaults: Required<ClientConfig>
  readonly file: ClientConfig
  readonly overrides: ClientConfig
  readonly resolved: Required<ClientConfig>
  readonly paths: {
    readonly file?: string
    readonly overrides?: string
  }
}

export const defaultClientConfig = (): Required<ClientConfig> => ({
  expand_tool_blocks_by_default: false,
  transcript_display_mode: 'pretty',
})

export const mergeClientConfig = <TBase extends ClientConfig>(
  base: TBase,
  override: ClientConfig
): TBase => ({
  ...base,
  ...(override.expand_tool_blocks_by_default === undefined
    ? {}
    : {
        expand_tool_blocks_by_default: override.expand_tool_blocks_by_default,
      }),
  ...(override.transcript_display_mode === undefined
    ? {}
    : { transcript_display_mode: override.transcript_display_mode }),
})

export const diffClientConfig = (
  base: Required<ClientConfig>,
  value: Required<ClientConfig>
): ClientConfig => ({
  ...(value.expand_tool_blocks_by_default === base.expand_tool_blocks_by_default
    ? {}
    : {
        expand_tool_blocks_by_default: value.expand_tool_blocks_by_default,
      }),
  ...(value.transcript_display_mode === base.transcript_display_mode
    ? {}
    : { transcript_display_mode: value.transcript_display_mode }),
})

export const encodeClientConfig = (config: ClientConfig): string =>
  `${JSON.stringify(Schema.encodeUnknownSync(ClientConfigSchema)(config), null, 2)}\n`
