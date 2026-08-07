import { isBuiltin } from 'node:module'
import { describe, expect, it } from 'vitest'
import { build, type Plugin } from 'vite'

const entryPath = new URL('./browser-shared-entry.fixture.ts', import.meta.url)
  .pathname
const forbiddenCoreModules = [
  '/packages/core/src/tool/tool-output.ts',
  '/packages/core/src/tool/glob.ts',
]

const browserBoundaryPlugin: Plugin = {
  name: 'browser-shared-boundary',
  resolveId(source) {
    if (isBuiltin(source)) {
      throw new Error(`Browser-shared entry imported Node builtin: ${source}`)
    }
  },
  transform(_code, id) {
    const normalizedId = id.replaceAll('\\', '/')
    const forbiddenModule = forbiddenCoreModules.find((module) =>
      normalizedId.includes(module)
    )
    if (forbiddenModule !== undefined) {
      throw new Error(
        `Browser-shared entry reached server module: ${forbiddenModule}`
      )
    }
  },
}

describe('browser-shared package boundaries', () => {
  it('bundles without Node builtins or server tool modules', async () => {
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [browserBoundaryPlugin],
      build: {
        write: false,
        lib: {
          entry: entryPath,
          formats: ['es'],
        },
      },
    })

    expect(output).toBeDefined()
  })
})
