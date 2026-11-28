// D60: v2 публикуется рядом с legacy в dist/v2 — в той же области service worker legacy. Он не отдаёт на /v2/
// свою страницу и не кэширует файлы v2, а v2 открывается и считает в воркере по относительным адресам.
// D61: в опубликованной сборке нет каталога дизайн-системы.
import { test, expect } from '@playwright/test';

test('060 · v2 по адресу /v2/ рядом с legacy: service worker legacy её не подменяет', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit не поддерживает Service Worker сборки так же, как Safari; адрес v2 на iPhone — в протоколе v2.');
  // Service Worker сборки регистрируется по HTTPS или на localhost с ?sw (src/main.tsx).
  await page.goto('http://localhost:4173/?sw');
  const ready = await page.evaluate(() => 'serviceWorker' in navigator && Promise.race([
    navigator.serviceWorker.ready.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 15000))]));
  test.skip(!ready, 'Service Worker недоступен в этом движке Playwright.');

  await page.goto('http://localhost:4173/v2/');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page).toHaveTitle(/Room Acoustics v2$/);
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('http://localhost:4173/v2/#/rooms/new/manual');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('tab', { name: 'Анализ' }).click();
  await expect(page.getByRole('list', { name: 'Ключевые показатели' })).toContainText('Неровность баса в месте слушателя', { timeout: 30_000 });

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) urls.push(...(await (await caches.open(name)).keys()).map((r) => r.url));
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((u) => u.includes('/v2/'))).toEqual([]);

  await page.goto('http://localhost:4173/v2/#/catalog');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
  await page.goto('http://localhost:4173/v2/#/settings');
  await expect(page.getByRole('heading', { name: 'О приложении' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Каталог дизайн-системы' })).toHaveCount(0);
});
