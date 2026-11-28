// V2-046: форма комнаты (Г-образная по шаблону, предпросмотр, части на плане, отмена; отказ для наклонной стены) и
// скан помещения (распознавание в воркере, применение к конфигурации).
import { test, expect, type Page } from '@playwright/test';
import { makeRoomScan, toOBJ } from '../../fixtures/synthetic';

async function start(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Продвинутый/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new/manual');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

const card = (page: Page, title: string) => page.locator('.al-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('059 · форма комнаты: Г-образная, части на плане, отмена, отказ для наклонной стены', async ({ page }) => {
  await start(page);
  await page.getByRole('link', { name: 'Помещение' }).click();
  const shape = card(page, 'Форма комнаты');
  await expect(shape).toContainText('Сейчас: прямоугольная комната.');
  await shape.getByLabel('Форма').selectOption({ label: 'Г-образная' });
  await expect(shape.getByRole('group', { name: /^Предпросмотр формы/ })).toHaveAttribute('aria-label', /За стенами: Часть 1/);
  await shape.getByRole('button', { name: 'Применить форму' }).click();
  await expect(page.getByText(/^Форма применена\./)).toBeVisible();
  await expect(shape).toContainText('Сейчас: г-образная, частей — 1.');
  await expect(card(page, 'Смежные зоны')).toContainText('Часть формы');

  await page.getByRole('link', { name: 'Модель: обзор' }).click();
  await expect(page.locator('.al-plan__svg').first()).toHaveAttribute('aria-label', /За стенами: Часть комнаты 1/);
  await expect(page.locator('.al-plan__annex--part')).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить: Форма: г-образная' }).click();
  await expect(page.locator('.al-plan__annex--part')).toHaveCount(0);

  await page.getByRole('link', { name: 'Помещение' }).click();
  await shape.getByLabel('Форма').selectOption({ label: 'По точкам контура' });
  await shape.getByLabel('Точки контура').fill('0; 0\n5; 0\n5; 4\n0; 3');
  await expect(shape.getByText('Форму нельзя применить')).toBeVisible();
  await expect(shape).toContainText('наклонный');
  await shape.getByLabel('Точки контура').fill('0; 0\n6; 0\n6; 2\n7,5; 2\n7,5; 4\n0; 4');
  await expect(shape).toContainText('Основная часть 6 × 4 × 2,5 м, частей — 1');
});

test('059 · новая комната по скану (D61): способ на первом шаге, размеры не запрашиваются', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByRole('radio', { name: /Продвинутый/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByRole('group', { name: 'Как задать комнату' }).getByRole('radio', { name: /По скану/ }).check();
  await expect(page.getByLabel('Длина', { exact: true })).toHaveCount(0);
  const create = page.getByRole('button', { name: 'Создать', exact: true });
  await expect(create).toBeDisabled();
  const file = card(page, 'Файл скана');
  const obj = toOBJ(makeRoomScan({ depth: 6, width: 4.5, height: 2.6, openings: true }));
  await file.getByLabel('Файл скана').setInputFiles({ name: 'room.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) });
  await expect(file).toContainText(/6,00 × 4,5\d × 2,60 м/, { timeout: 60_000 });
  await expect(file.getByRole('group', { name: 'Двери, окна и проёмы из скана' })).toBeVisible();
  await page.getByLabel('Название').fill('Гостиная по скану');
  await create.click();
  await expect(page.getByText(/^Комната «Гостиная по скану» создана по скану «room\.obj»/)).toBeVisible();
  await page.getByRole('link', { name: 'Помещение' }).click();
  await expect(page.getByLabel('Длина (от передней стены к задней)')).toHaveValue('6');
  await expect(card(page, 'Скан помещения')).toContainText('Применён скан «room.obj»');
});

test('059 · скан помещения: распознавание и применение к конфигурации', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await page.getByRole('link', { name: 'Помещение' }).click();
  const scan = card(page, 'Скан помещения');
  const obj = toOBJ(makeRoomScan({ depth: 6, width: 4.5, height: 2.6, openings: true }));
  await scan.getByLabel('Файл скана').setInputFiles({ name: 'room.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) });
  await expect(scan).toContainText(/6,00 × 4,5\d × 2,60 м/, { timeout: 60_000 });
  await expect(scan.getByRole('group', { name: 'Двери, окна и проёмы из скана' })).toBeVisible();
  await scan.getByRole('button', { name: 'Применить к конфигурации' }).click();
  await expect(page.getByText(/^Скан применён/)).toBeVisible();
  await expect(page.getByLabel('Длина (от передней стены к задней)')).toHaveValue('6');
  await expect(scan).toContainText('Применён скан «room.obj»');
});
