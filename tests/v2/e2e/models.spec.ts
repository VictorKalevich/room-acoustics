// V2-048: расширенные модели на продвинутом уровне — Фицрой и Арау-Пучадес, ясность по Баррону, отражения до
// 3-го порядка методом мнимых источников с выбором колонки и полосы.
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('./');
  await page.getByRole('radio', { name: /Продвинутый/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

const section = (page: Page, s: string) => page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, `#/rooms/$1/analysis/${s}`));

test('059 · расширенные модели: реверберация по моделям, ясность, отражения до 3-го порядка', async ({ page }) => {
  await start(page);
  await section(page, 'reverb');
  await expect(page.getByRole('table', { name: 'Модели реверберации по октавам' }).getByRole('row')).toHaveCount(8);
  await expect(page.getByRole('figure').filter({ hasText: 'Арау-Пучадес' })).toBeVisible();
  const clarity = page.getByRole('table', { name: 'Ясность и прямой звук по октавам' });
  await expect(clarity.getByRole('row')).toHaveCount(8);
  await expect(clarity.getByRole('row').filter({ hasText: '1 кГц' })).toContainText(/дБ.*дБ.*%.*дБ.*м/);
  await expect(clarity.getByRole('row').filter({ hasText: '63 Гц' })).toContainText('—');
  await page.getByLabel('Колонка').selectOption({ label: 'Правая колонка' });
  await expect(page.getByText(/^До колонки \d+,\d+ м\./)).toBeVisible();

  await section(page, 'reflections');
  const table = page.getByRole('table', { name: 'Самые сильные отражения до 3-го порядка' });
  await expect(table.getByRole('row')).toHaveCount(13);
  await expect(page.getByText('Путей рассчитано')).toBeVisible();
  await page.getByLabel('Полоса').selectOption('4000');
  await expect(page.getByRole('img', { name: /^Отражения до 3-го порядка, 4 кГц/ })).toBeVisible();
  const chart = page.getByRole('img', { name: /^Отражения до 3-го порядка, 4 кГц/ });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/^Ориентир «зоны без отражений».*Выбрано: .+, \d+,\d мс, [−-]?\d+,\d дБ, приходит /)).toBeVisible();
});
