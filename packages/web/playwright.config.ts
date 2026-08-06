import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command:
      'bun --bun vite --config vite.scroll-stability.config.ts --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/scroll-stability.html',
    reuseExistingServer: true,
  },
})
