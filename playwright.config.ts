import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4173/' },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  // на сервере GitHub — повтор упавшего теста и отчёт с видео/трассой только для упавших
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  projects: [
    // 021: расчёты открываются, когда комната создана; проверки начинают с готовой комнаты из room.setup.ts.
    // Сценарии первого запуска сбрасывают состояние сами: test.use({ storageState: EMPTY }).
    {
      name: 'setup',
      testMatch: /room\.setup\.ts/,
      use: { ...devices['iPhone 15 Pro'], browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined },
    },
    {
      name: 'setup-safari',
      testMatch: /room\.setup\.ts/,
      use: { ...devices['iPhone 15 Pro'] },
    },
    {
      name: 'iphone',
      // Эмуляция iPhone в Chromium (работает везде, в том числе в контейнере и на сервере GitHub)
      use: { ...devices['iPhone 15 Pro'], browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined, trace: 'retain-on-failure', storageState: 'tests/e2e/.auth/setup.json' },
      dependencies: ['setup'],
    },
    {
      name: 'iphone-safari',
      // Тот же iPhone на движке Safari (WebKit): npm run e2e:safari на компьютере.
      // Первый раз: npx playwright install webkit
      use: { ...devices['iPhone 15 Pro'], trace: 'retain-on-failure', storageState: 'tests/e2e/.auth/setup-safari.json' },
      dependencies: ['setup-safari'],
    },
  ],
});
