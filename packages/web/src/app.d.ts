// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  interface Window {
    soratoDesktop?: {
      getBootstrap: () => {
        readonly platform: NodeJS.Platform
      }
      getClientConfig: () => Promise<ResolvedClientConfig>
      setClientConfigOverrides: (
        overrides: ClientConfig
      ) => Promise<ResolvedClientConfig>
      selectImages: () => Promise<
        ReadonlyArray<{
          readonly mediaType: string
          readonly fileName: string
          readonly data: string
          readonly size: number
        }>
      >
      startIntegratedServer: () => Promise<{
        readonly url: string
        readonly pid?: number
      }>
      stopIntegratedServer: () => Promise<void>
    }
  }

  interface ToolBlockExpansion {
    readonly default?: boolean
    readonly tools?: Record<string, boolean | null>
  }

  interface ResolvedToolBlockExpansion {
    readonly default: boolean
    readonly tools: Record<string, boolean>
  }

  interface ClientConfig {
    readonly expand_tool_blocks_by_default?: boolean
    readonly tool_block_expansion?: ToolBlockExpansion
    readonly transcript_display_mode?: 'pretty' | 'raw'
    readonly expand_system_messages_by_default?: boolean
  }

  interface ResolvedClientConfigValue {
    readonly expand_tool_blocks_by_default: boolean
    readonly tool_block_expansion: ResolvedToolBlockExpansion
    readonly transcript_display_mode: 'pretty' | 'raw'
    readonly expand_system_messages_by_default: boolean
  }

  interface ResolvedClientConfig {
    readonly defaults: ResolvedClientConfigValue
    readonly file: ClientConfig
    readonly overrides: ClientConfig
    readonly resolved: ResolvedClientConfigValue
    readonly paths: {
      readonly file?: string
      readonly overrides?: string
    }
  }

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {}
