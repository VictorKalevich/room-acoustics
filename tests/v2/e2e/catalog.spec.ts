// V2-011–V2-015: каталог Acoustic Lab в браузере — ширины, темы, клавиатура, диалоги, план и график.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./#/catalog');
  await expect(page.getByRole('heading', { level: 1, name: 'Каталог дизайн-системы' })).toBeVisible();
});

test('059 · каталог помещается по ширине на 320, 390, 768, 1024 и 1440 px, без ошибок', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `ширина ${width} px`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test('059 · тема: светлая, тёмная и системная меняют цвета и сохраняются', async ({ page }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = page.getByRole('radiogroup', { name: 'Тема' });
  await theme.getByRole('radio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).toBe('rgb(16, 23, 30)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radiogroup', { name: 'Тема' }).getByRole('radio', { name: 'Светлая' }).click();
  expect(await bg()).toBe('rgb(244, 246, 248)');
  await page.getByRole('radiogroup', { name: 'Тема' }).getByRole('radio', { name: 'Как в системе' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await page.evaluate(() => localStorage.getItem('ra2.theme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg()).toBe('rgb(16, 23, 30)');
});

test('059 · сегменты и вкладки переключаются стрелками', async ({ page }) => {
  const seg = page.getByRole('radiogroup', { name: 'Сложность' });
  await seg.getByRole('radio', { name: 'Простой' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(seg.getByRole('radio', { name: 'Продвинутый' })).toHaveAttribute('aria-checked', 'true');
  await expect(seg.getByRole('radio', { name: 'Продвинутый' })).toBeFocused();
  await page.getByRole('tab', { name: 'Бас' }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Отражения' })).toHaveAttribute('aria-selected', 'true');
});

test('059 · диалог: фокус на отмене, Tab не выходит наружу, Esc закрывает и возвращает фокус', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Диалог подтверждения' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: 'Удалить комнату?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('059 · число принимает запятую и показывает ошибку диапазона', async ({ page }) => {
  const field = page.getByLabel('Длина');
  await field.fill('0,5');
  await field.press('Enter');
  await expect(page.getByText('Не меньше 1 м.')).toBeVisible();
  await field.fill('3,25');
  await field.press('Enter');
  await expect(field).toHaveValue('3,25');
  await expect(page.getByText('Не меньше 1 м.')).toHaveCount(0);
});

test('059 · план: объект выбирается и двигается стрелками, закреплённый — нет', async ({ page }) => {
  const plan = page.getByRole('group', { name: /Демонстрационная комната/ });
  const left = plan.getByRole('button', { name: /^L \(колонка\)/ });
  await left.focus();
  await page.keyboard.press('Enter');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(plan.getByRole('button', { name: /^L \(колонка\): x 0,50 м, y 1,05 м/ })).toBeVisible();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(plan.getByRole('button', { name: /^L \(колонка\): x 0,75 м, y 1,05 м/ })).toBeVisible();
  const diff = plan.getByRole('button', { name: /^Диффузор/ });
  const before = await diff.getAttribute('aria-label');
  await diff.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await diff.getAttribute('aria-label')).toBe(before);
  expect(before).toMatch(/закреплён/);
});

test('059 · график: значения стрелками, легенда различает вид данных подписью', async ({ page }) => {
  const chart = page.getByRole('img', { name: /^Демонстрация\. Ось частот/ });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.al-chart__readout').first()).toContainText('Гц: Замер');
  await expect(page.getByRole('list', { name: 'Обозначения' }).first()).toContainText('Замер (измерение)');
  await expect(page.getByRole('list', { name: 'Обозначения' }).first()).toContainText('Модель (расчёт)');
  const dashes = await page.locator('.al-chart__svg path[data-kind]').evaluateAll((els) => els.slice(0, 3).map((e) => getComputedStyle(e).strokeDasharray));
  expect(dashes[0]).toBe('none');
  expect(dashes[1]).not.toBe('none');
  expect(dashes[2]).not.toBe(dashes[1]);
});
