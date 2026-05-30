import { Schema } from 'effect'

export const ToolOutputFormatSchema = Schema.Literals(['pretty', 'raw'])
export type ToolOutputFormat = typeof ToolOutputFormatSchema.Type

export const ClientConfigSchema = Schema.Struct({
  expand_tool_blocks_by_default: Schema.optional(Schema.Boolean),
  tool_output_format: Schema.optional(ToolOutputFormatSchema),
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
  tool_output_format: 'pretty',
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
  ...(override.tool_output_format === undefined
    ? {}
    : { tool_output_format: override.tool_output_format }),
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
  ...(value.tool_output_format === base.tool_output_format
    ? {}
    : { tool_output_format: value.tool_output_format }),
})

export const encodeClientConfig = (config: ClientConfig): string =>
  `${JSON.stringify(Schema.encodeUnknownSync(ClientConfigSchema)(config), null, 2)}\n`
