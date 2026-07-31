import { foldkit } from '@foldkit/vite-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [foldkit()],
  test: { environment: 'happy-dom', setupFiles: ['./vitest-setup.ts'] },
})
