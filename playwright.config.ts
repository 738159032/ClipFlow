import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a production build and the locally installed Chrome
 * (channel: 'chrome') because WebCodecs H.264 encoding support is required and
 * Playwright's bundled Chromium does not ship proprietary codecs.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results/artifacts',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chrome-webcodecs',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 960 } },
    },
  ],
  webServer: {
    command: 'npm run start -- -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
