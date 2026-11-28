// V2-031–V2-035: вкладка «Анализ» — обзор с показателями и проблемами, разделы со своими адресами, связь пути
// отражения с графиком, карта качества баса по запросу, место для записи, сравнение с экспериментом.
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Простой/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new/manual');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

const section = (page: Page, s: string) => page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, `#/rooms/$1/analysis/${s}`));

test('059 · анализ: обзор, разделы, отражения на плане и во времени, реверберация', async ({ page }) => {
  await start(page);
  await page.getByRole('tab', { name: 'Анализ' }).click();
  const metrics = page.getByRole('list', { name: 'Ключевые показатели' });
  await expect(metrics).toBeVisible({ timeout: 30_000 });
  await expect(metrics).toContainText('Неровность баса в месте слушателя');
  await expect(metrics).toContainText('Стереоугол');
  await expect(page.getByRole('list', { name: 'Проблемы' })).toBeVisible();

  await page.getByRole('link', { name: 'Качество баса', exact: true }).click();
  await expect(page).toHaveURL(/\/analysis\/bass$/);
  const modes = page.getByRole('table', { name: 'Моды комнаты' });
  await expect(modes).toBeVisible({ timeout: 30_000 });
  const few = await modes.getByRole('row').count();
  await page.getByRole('switch', { name: /Все моды/ }).click();
  await expect.poll(() => modes.getByRole('row').count()).toBeGreaterThan(few);
  await page.getByRole('link', { name: 'Анализ: обзор' }).click();
  await expect(page).toHaveURL(/\/analysis$/);

  await section(page, 'reflections');
  const show = page.getByRole('button', { name: /^Показать: Левая колонка, левая стена/ });
  await show.click();
  await expect(show).toHaveText('Показано');
  await expect(page.locator('.al-plan__path--selected')).toHaveCount(1);
  await expect(page.locator('.al-chart__stem--selected')).toHaveCount(1);
  await expect(page.locator('.al-chart__readout').filter({ hasText: 'Левая колонка: левая стена' })).toContainText('мс');

  await section(page, 'reverb');
  await expect(page.getByRole('table', { name: 'Реверберация по октавам' }).getByRole('row')).toHaveCount(8);
  await page.getByLabel('Частота').selectOption('2000');
  await expect(page.getByRole('table', { name: 'Вклад поверхностей в поглощение' }).getByRole('row')).toHaveCount(7);

  await section(page, 'treatment');
  await expect(page.getByText('Обработки нет')).toBeVisible();
  await section(page, 'measurements');
  await expect(page.getByText('Измерений нет')).toBeVisible();
});

test('059 · анализ: карта качества баса по запросу, место для записи, сравнение с экспериментом', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await page.getByRole('button', { name: 'Создать эксперимент' }).click();
  const left = page.locator('.al-plan__object[aria-label^="L (колонка)"]');
  await left.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.getByRole('tab', { name: 'Анализ' }).click();
  await expect(page.getByRole('list', { name: 'Ключевые показатели' })).toContainText('Текущая:', { timeout: 30_000 });

  await section(page, 'listeners');
  const map = page.getByRole('heading', { name: 'Карта качества баса' }).locator('xpath=ancestor::section[1]');
  await map.getByRole('button', { name: 'Рассчитать' }).click();
  await expect(page.getByRole('list', { name: 'Шкала: карта качества баса' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('table', { name: 'Лучшие места: карта качества баса' })).toBeVisible();
  await page.getByRole('switch', { name: 'Показать устойчивость к смещению головы' }).click();
  await expect(page.getByRole('list', { name: 'Шкала: карта устойчивости места' })).toBeVisible();

  const mic = page.getByRole('radiogroup', { name: 'Микрофон' });
  await mic.getByRole('radio', { name: 'Суперкардиоида' }).click();
  await expect(mic.getByRole('radio', { name: 'Суперкардиоида' })).toHaveAttribute('aria-checked', 'true');
  // настройка записана в эксперимент и сохранена; текущая конфигурация не изменилась
  await page.reload();
  const config = page.getByRole('radiogroup', { name: 'Конфигурация' });
  await config.getByRole('radio', { name: 'Текущая' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Микрофон' }).getByRole('radio', { name: 'Кардиоида', exact: true })).toHaveAttribute('aria-checked', 'true');
  await config.getByRole('radio', { name: 'Эксперимент' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Микрофон' }).getByRole('radio', { name: 'Суперкардиоида' })).toHaveAttribute('aria-checked', 'true');
});
