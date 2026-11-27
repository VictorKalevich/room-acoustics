import { defineConfig, devices } from '@playwright/test';

// Проверка оболочки v2 (V2-005): своя сборка dist-v2 и свой порт; сценарии legacy — playwright.config.ts.
const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined;

export default defineConfig({
  testDir: 'tests/v2/e2e',
  outputDir: 'test-results/v2',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4174/' },
  webServer: {
    command: 'npm run build:v2 && npx vite preview --config vite.v2.config.ts --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-v2' }], ['github']] : 'list',
  projects: [
    { name: 'v2-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel } },
    { name: 'v2-iphone', use: { ...devices['iPhone 15 Pro'], browserName: 'chromium', channel } },
  ],
});
