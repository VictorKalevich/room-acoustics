// V2-058: производительность, работа без сети и восстановление данных. Время — замер для отчёта с запасом в пороге
// (ловит грубые регрессии, а не колебания машины). Без сети — после загрузки: service worker у v2 нет (R05, R58),
// поэтому холодный запуск без сети не проверяется. Восстановление — резервная копия в пустой профиль браузера.
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

async function onboard(page: Page) {
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
}

async function createRoom(page: Page, name: string) {
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill(name);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForURL(/#\/rooms\/[^/]+\/model/);
}

const metrics = (page: Page) => page.getByRole('list', { name: 'Ключевые показатели' });

test('059 · производительность: первый экран и расчёт комнаты в пределах бюджета, без долгих блокировок', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch { /* нет longtask */ }
  });
  const slow = info.project.name.includes('iphone') ? 4 : 1;
  if (slow > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: slow });
  let t = Date.now();
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'Как подробно показывать акустику?' })).toBeVisible();
  const first = Date.now() - t;
  await onboard(page);
  await createRoom(page, 'Гостиная');
  t = Date.now();
  await page.getByRole('tab', { name: 'Анализ' }).click();
  await expect(metrics(page)).toContainText('Неровность баса в месте слушателя', { timeout: 30_000 });
  const analysis = Date.now() - t;
  const p = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const js = res.filter((r) => /\.js(\?|$)/.test(r.name));
    return {
      longTasks: (window as unknown as { longTasks: number[] }).longTasks,
      jsKb: Math.round(js.reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0) / 1024),
      heapMb: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576) : null,
    };
  });
  const longest = Math.round(Math.max(0, ...p.longTasks));
  const summary = `${info.project.name}${slow > 1 ? `, процессор медленнее в ${slow} раза` : ''}: первый экран ${first} мс; анализ комнаты ${analysis} мс; JS ${p.jsKb} КБ; долгих задач ${p.longTasks.length}, самая долгая ${longest} мс; память ${p.heapMb ?? '—'} МБ`;
  info.annotations.push({ type: 'perf', description: summary });
  console.log(summary);
  expect(first).toBeLessThan(5_000);
  expect(analysis).toBeLessThan(20_000);
  expect(longest).toBeLessThan(2_000);
});

test('059 · без сети после загрузки: правка, расчёт, инструменты и сохранение работают; запросов за пределы приложения нет', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const foreign: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
  await page.goto('./');
  await onboard(page);
  await createRoom(page, 'Гостиная');
  await page.getByRole('tab', { name: 'Анализ' }).click();
  await expect(metrics(page)).toContainText('Неровность баса', { timeout: 30_000 });

  await page.context().setOffline(true);
  await createRoom(page, 'Спальня');
  await page.getByRole('tab', { name: 'Анализ' }).click();
  await expect(metrics(page)).toContainText('Неровность баса', { timeout: 30_000 });
  await page.goto('./#/tools/room-modes');
  await expect(page.getByRole('heading', { level: 1, name: 'Комнатные моды' })).toBeVisible();
  await page.goto('./#/rooms');
  await expect(page.getByRole('main')).toContainText('Спальня');
  await expect(page.getByRole('main')).toContainText('Гостиная');
  await page.context().setOffline(false);
  expect(foreign).toEqual([]);
});

test('059 · восстановление: копия переносит комнаты в пустой профиль; повреждённый файл отклоняется с причиной', async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await onboard(page);
  await createRoom(page, 'Гостиная');
  await page.goto('./#/settings');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить резервную копию' }).click();
  const file = info.outputPath('backup.ra2backup.json');
  await (await dl).saveAs(file);
  expect(JSON.parse(await readFile(file, 'utf-8')).format).toBe('room-acoustics-v2-backup');

  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const fresh = await ctx.newPage();
  await fresh.goto('./');
  await onboard(fresh);
  await fresh.goto('./#/settings');
  const bad = info.outputPath('bad.json');
  await writeFile(bad, '{"format":"что-то другое"}');
  await fresh.getByLabel('Восстановить из копии').setInputFiles(bad);
  await expect(fresh.getByText('Это не резервная копия Room Acoustics v2.')).toBeVisible();
  await fresh.getByLabel('Восстановить из копии').setInputFiles(file);
  await fresh.getByRole('button', { name: 'Добавить недостающее' }).click();
  await expect(fresh.getByText('Копия восстановлена')).toBeVisible();
  await fresh.goto('./#/rooms');
  await expect(fresh.getByRole('main')).toContainText('Гостиная');
  await ctx.close();
});
