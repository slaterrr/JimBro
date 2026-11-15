import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'chat-mvp.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: '../e2e-artifacts/chat-mvp',
  reporter: [['list'], ['html', { outputFolder: '../e2e-artifacts/chat-mvp-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:18085',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] },
  },
});
