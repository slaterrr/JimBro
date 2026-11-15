// Playwright user-journey tests against the static web export (npm run test:e2e).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'journeys.spec.mjs', // chat-mvp has its own HTTP fixture/config
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'e2e-artifacts/playwright' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'e2e-artifacts/playwright-results',
  webServer: { command: 'node e2e/serve.mjs dist-web 4173', port: 4173, reuseExistingServer: !process.env.CI },
});
