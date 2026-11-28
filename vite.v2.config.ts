import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

// Оболочка v2 (V2-005, D58): свои порты и каталог сборки, без PWA и service worker, без public/ legacy.
// Другой порт — другой origin: хранилище, кэш и service worker legacy не разделяются с v2.
export default defineConfig({
  root: fileURLToPath(new URL('./src/v2/app/', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [preact()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist-v2/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
});
