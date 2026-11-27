// V2-005, V2-016 (D58): приложение v2 запускается отдельно. При запуске — только своя IndexedDB v2: без service
// worker, микрофона, звука, воркеров, внешних запросов, базы и стилей legacy.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name).replaceAll('\\', '/')]);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { v2Calls: string[] }).v2Calls = calls;
    const method = (owner: object | undefined, key: string, label: string) => {
      const o = owner as Record<string, unknown> | undefined;
      const f = o?.[key];
      if (!o || typeof f !== 'function') return;
      o[key] = new Proxy(f, { apply(target, self, args) { calls.push(label); return Reflect.apply(target as (...a: unknown[]) => unknown, self, args); } });
    };
    const ctor = (name: string) => {
      const w = window as unknown as Record<string, unknown>;
      const C = w[name];
      if (typeof C !== 'function') return;
      w[name] = new Proxy(C, { construct(target, args, next) { calls.push(name); return Reflect.construct(target as new (...a: unknown[]) => object, args, next); } });
    };
    method(navigator.mediaDevices, 'getUserMedia', 'getUserMedia');
    method(navigator.serviceWorker, 'register', 'serviceWorker.register');
    method(Storage.prototype, 'setItem', 'storage.setItem');
    method(window.caches, 'open', 'caches.open');
    method(HTMLMediaElement.prototype, 'play', 'media.play');
    method(navigator.storage, 'persist', 'storage.persist');
    for (const name of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'Worker', 'SharedWorker']) ctor(name);
  });
});

test('059 · запуск v2: первый запуск без звука, микрофона, service worker, базы и стилей legacy', async ({ page, baseURL }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  await expect(page).toHaveTitle('Выбор сложности — Room Acoustics v2');
  await expect(page.getByRole('heading', { level: 1, name: 'Как подробно показывать акустику?' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await page.waitForLoadState('networkidle');

  const state = await page.evaluate(async () => ({
    calls: (window as unknown as { v2Calls: string[] }).v2Calls.slice(),
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: navigator.serviceWorker.controller !== null,
    manifest: document.querySelector('link[rel="manifest"]') !== null,
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    cookie: document.cookie,
    databases: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
    font: getComputedStyle(document.body).fontFamily,
    legacyCss: [...document.styleSheets].some((s) => [...s.cssRules].some((r) => /Golos|--space-stack/.test(r.cssText))),
  }));
  const { font, ...rest } = state;
  expect(rest).toEqual({
    calls: [], serviceWorkers: 0, controlled: false, manifest: false, localStorage: 0, sessionStorage: 0, cookie: '',
    databases: ['room-acoustics-v2'], caches: [], legacyCss: false,
  });
  expect(font).not.toMatch(/Golos/);
  expect(font).toMatch(/^"?Inter Variable/);
  expect(requests.filter((u) => !u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('059 · первый запуск и главная помещаются по ширине на 320, 390 и 1440 px', async ({ page }) => {
  await page.goto('./');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `первый запуск ${width} px`).toBeLessThanOrEqual(0);
  }
  await page.getByRole('button', { name: 'Продолжить' }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole('heading', { level: 1, name: 'Акустика вашей комнаты' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `главная ${width} px`).toBeLessThanOrEqual(0);
  }
});

test('059 · сборка v2 — отдельный каталог без service worker, манифеста и файлов public/ legacy', () => {
  const v2 = walk('dist-v2');
  expect(v2.filter((p) => /(^|\/)(sw\.js|registerSW\.js|manifest\.webmanifest|workbox-[^/]*\.js)$/.test(p) || /\/(icons|field-check)\//.test(p))).toEqual([]);
  expect(readFileSync('dist-v2/index.html', 'utf8')).not.toMatch(/manifest|registerSW|serviceWorker/);
});

test('059 · сборка legacy не содержит v2', () => {
  test.skip(!existsSync('dist/index.html'), 'Сборка legacy (npm run build) не выполнялась перед этим прогоном.');
  const legacy = walk('dist').filter((p) => /\.(html|js|css|webmanifest)$/.test(p));
  expect(legacy.filter((p) => readFileSync(p, 'utf8').includes('Room Acoustics v2'))).toEqual([]);
});
