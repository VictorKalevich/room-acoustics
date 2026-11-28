// V2-051: экспертный уровень раздела «Качество баса» — карта уровня от источников, форма и фаза моды, сравнение
// прямоугольной и волновой моделей, параметры сетки волновой модели.
import { test, expect } from '@playwright/test';

test('059 · поле на высоте ушей и модели расчёта баса', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByRole('radio', { name: /Экспертный/ }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill('Гостиная');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
  await page.goto(page.url().replace(/#\/rooms\/([^/]+)\/.*$/, '#/rooms/$1/analysis/bass'));

  const field = page.locator('.al-card').filter({ has: page.getByRole('heading', { name: 'Поле на высоте ушей' }) });
  await expect(field.getByRole('radio', { name: 'Разница конфигураций' })).toBeDisabled();
  await field.getByRole('button', { name: 'Рассчитать' }).click();
  await expect(field.getByRole('list', { name: /^Шкала: уровень на/ })).toBeVisible({ timeout: 60_000 });
  await expect(field.locator('.al-plan__heat-cell--d2').first()).toBeAttached();
  await expect(field.getByText('тише среднего')).toBeVisible();

  await field.getByRole('radio', { name: 'Форма моды' }).click();
  await expect(field.getByText('противофаза')).toBeVisible();
  await expect(field.getByText(/Знак — фаза стоячей волны/)).toBeVisible();
  await field.getByLabel('Мода', { exact: true }).selectOption({ index: 2 });
  await expect(field.getByRole('list', { name: /^Шкала: мода/ })).toBeVisible();

  const models = page.locator('.al-card').filter({ has: page.getByRole('heading', { name: 'Модели расчёта баса' }) });
  await models.getByRole('button', { name: 'Параметры сетки волновой модели' }).click();
  await expect(models.getByText('Число Куранта', { exact: true })).toBeVisible({ timeout: 30_000 });
  await models.getByRole('button', { name: 'Рассчитать' }).click();
  const table = page.getByRole('table', { name: 'Модели расчёта баса' });
  await expect(table).toBeVisible({ timeout: 180_000 });
  await expect(table).toContainText('Волновая (FDTD)');
  await expect(models.getByText('Расхождение моделей (СКО)')).toBeVisible();
});
