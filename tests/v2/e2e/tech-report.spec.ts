// V2-055: технический отчёт на экспертном уровне — HTML с графиком и разделами, JSON и CSV, сохранение в «Мои данные»
// с видом «технический, HTML»; на простом уровне блока нет.
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page, level: RegExp) {
  await page.goto('./');
  await page.getByRole('radio', { name: level }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForURL(/#\/rooms\/[^/]+\/model/);
  await page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, '#/rooms/$1/advice/reports'));
}

const card = (page: Page, title: string) => page.locator('.al-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('059 · технический отчёт: HTML, JSON, CSV и сохранение', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page, /Экспертный/);
  const t = card(page, 'Технический отчёт');
  await expect(t).toBeVisible({ timeout: 30_000 });
  await expect(t.getByText(/Расчёт конфигурации не готов/)).toHaveCount(0, { timeout: 60_000 });

  const html = page.waitForEvent('download');
  await t.getByRole('button', { name: 'Скачать HTML' }).click();
  const h = await html;
  expect(h.suggestedFilename()).toMatch(/^Гостиная_технический_отчёт_\d{4}-\d{2}-\d{2}\.html$/);
  const text = await readFile((await h.path())!, 'utf-8');
  for (const s of ['<!DOCTYPE html>', 'Технический отчёт: «Гостиная»', 'Отклик и показатели', 'Реверберация по октавам', 'Моды комнаты', '<polyline']) expect(text).toContain(s);
  expect(text).not.toMatch(/<script/i);

  const json = page.waitForEvent('download');
  await t.getByRole('button', { name: 'Данные, JSON' }).click();
  expect(JSON.parse(await readFile((await (await json).path())!, 'utf-8')).format).toBe('room-acoustics-v2-technical-report');
  const csv = page.waitForEvent('download');
  await t.getByRole('button', { name: 'Моды, CSV' }).click();
  expect((await readFile((await (await csv).path())!, 'utf-8')).split('\n')[0]).toBe('nx;ny;nz;f_hz;kind;degenerate;clustered');

  const svg = page.waitForEvent('download');
  await t.getByRole('button', { name: 'График АЧХ, SVG' }).click();
  const s = await svg;
  expect(s.suggestedFilename()).toMatch(/\.svg$/);
  expect(await readFile((await s.path())!, 'utf-8')).toContain('<svg xmlns="http://www.w3.org/2000/svg"');

  await t.getByRole('button', { name: 'Сохранить в «Мои данные»' }).click();
  const saved = page.getByRole('table', { name: 'Сохранённые отчёты' });
  await expect(saved.getByRole('row')).toHaveCount(2);
  await expect(saved).toContainText('технический, HTML');
  const again = page.waitForEvent('download');
  await saved.getByRole('button', { name: /^Скачать отчёт / }).click();
  expect((await again).suggestedFilename()).toMatch(/технический_отчёт_.*\.html$/);
});

test('059 · на простом уровне технического отчёта нет', async ({ page }) => {
  await start(page, /Простой/);
  await expect(card(page, 'Отчёт по комнате')).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'Технический отчёт')).toHaveCount(0);
});
