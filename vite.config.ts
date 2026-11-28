import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; }
}

export default defineConfig({
  base: './',
  define: {
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_BUILD_SHA__: JSON.stringify(buildSha()),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Акустика комнаты',
        short_name: 'Акустика',
        description: 'Расчёт мод комнаты и подбор расстановки колонок и сабвуфера по LiDAR-скану',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f1ea',
        theme_color: '#1d2a2e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // v2 (D60) лежит в dist/v2 в той же области service worker: legacy не кэширует её файлы
        // и не отдаёт свою index.html на её адрес
        globIgnores: ['**/node_modules/**/*', 'v2/**'],
        navigateFallbackDenylist: [/\/v2(\/|\?|$)/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
