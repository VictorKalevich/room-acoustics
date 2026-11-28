// V2-052: экспертный уровень инструментов конструкций — многослойная конструкция (слои, модель JCA, сравнение) и
// резонатор с потерями; на простом уровне этих блоков нет.
import { test, expect, type Page } from '@playwright/test';

const start = async (page: Page, level: RegExp) => {
  await page.goto('./');
  await page.getByRole('radio', { name: level }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
};

test('059 · многослойные конструкции и резонатор с потерями', async ({ page }) => {
  await start(page, /Экспертный/);
  await page.goto('./#/tools/absorber');
  const layers = page.getByRole('list', { name: 'Слои конструкции' });
  await expect(layers.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Поглощение по октавам: конструкция' })).toBeVisible();
  await page.getByRole('button', { name: 'Запомнить для сравнения' }).click();

  await page.getByLabel('Новый слой').selectOption('perforated');
  await page.getByRole('button', { name: 'Добавить слой' }).click();
  await layers.getByRole('button', { name: 'Слой 2 ближе к комнате' }).click();
  await expect(layers.getByRole('listitem').first()).toHaveAttribute('aria-label', 'Слой 1: Перфорированный лист');
  await page.getByLabel('Новый слой').selectOption('air');
  await page.getByRole('button', { name: 'Добавить слой' }).click();
  await expect(layers.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText('Максимум поглощения (диффузное поле)')).toBeVisible();
  await page.getByRole('button', { name: 'Запомнить для сравнения' }).click();
  const cmp = page.getByRole('table', { name: 'Сравнение конструкций' });
  await expect(cmp.getByRole('row')).toHaveCount(3);

  const second = layers.getByRole('listitem').nth(1);
  await second.getByLabel('Модель материала').selectOption('jca');
  await expect(second.getByLabel('Извилистость α∞')).toBeVisible();
  await second.getByLabel('Сопротивление продуванию σ').fill('60');
  await second.getByLabel('Сопротивление продуванию σ').press('Enter');
  await second.getByLabel('Модель материала').selectOption('delany-bazley');
  await expect(page.getByText(/вне области применимости/)).toBeVisible();

  await page.goto('./#/tools/resonator');
  await page.getByRole('radio', { name: 'Перфорированная панель' }).click();
  await expect(page.getByRole('heading', { name: 'С потерями (метод матриц переноса)' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Поглощение по октавам: резонатор' })).toBeVisible();
  await page.getByRole('radio', { name: 'Гельмгольц' }).click();
  await expect(page.getByText(/метод матриц переноса к нему не применяется/)).toBeVisible();
});

test('059 · на простом уровне многослойного расчёта нет', async ({ page }) => {
  await start(page, /Простой/);
  await page.goto('./#/tools/absorber');
  await expect(page.getByRole('heading', { name: 'Результат' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Слои конструкции' })).toHaveCount(0);
});
