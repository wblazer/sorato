// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  interface Window {
    soratoDesktop?: {
      getBootstrap: () => {
        readonly serverUrl: string
        readonly platform: NodeJS.Platform
      }
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
