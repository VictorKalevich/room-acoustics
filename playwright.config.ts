import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173/' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'iphone',
      // Эмуляция iPhone (WebKit-движок недоступен в CI-контейнере, используется Chromium)
      use: { ...devices['iPhone 15 Pro'], browserName: 'chromium' },
    },
  ],
});
