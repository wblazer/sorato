// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  interface Window {
    soratoDesktop?: {
      getBootstrap: () => {
        readonly serverUrl: string
        readonly platform: NodeJS.Platform
      }
      getClientConfig: () => Promise<ResolvedClientConfig>
      setClientConfigOverrides: (
        overrides: ClientConfig
      ) => Promise<ResolvedClientConfig>
    }
  }

  interface ClientConfig {
    readonly expand_tool_blocks_by_default?: boolean
    readonly transcript_display_mode?: 'pretty' | 'raw'
  }

  interface ResolvedClientConfig {
    readonly defaults: Required<ClientConfig>
    readonly file: ClientConfig
    readonly overrides: ClientConfig
    readonly resolved: Required<ClientConfig>
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
