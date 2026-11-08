import { test, expect } from '@playwright/test';

// Сквозные сценарии quickstart.md в эмуляции iPhone.
// Перед запуском: npm run fixtures (создаёт tests/fixtures/out/sample-room.obj).

test('US1: моды по ручным размерам', async ({ page }) => {
  await page.goto('/#room');
  await page.getByLabel('Глубина', { exact: true }).fill('5');
  await page.getByLabel('Ширина', { exact: true }).fill('4');
  await page.getByLabel('Высота', { exact: true }).fill('2,5');
  await page.getByRole('button', { name: 'Моды' }).click();
  const rows = page.locator('.modes-table tbody tr');
  await expect(rows.nth(0)).toContainText('34,3');
  await expect(rows.nth(1)).toContainText('42,9');
  await expect(rows.nth(2)).toContainText('54,9');
  await expect(page.getByText('Глубина ≈ 2 × высота')).toBeVisible();
});

test('US2: подбор расстановки за ≤ 10 с, лучший не хуже базового', async ({ page }) => {
  await page.goto('/#placement');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Подобрать расстановку' }).click();
  await expect(page.locator('.score__value')).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.locator('.score__delta')).toContainText(/ровнее|как базовая/);
});

test('US3: загрузка скана и распознавание размеров', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-room.obj');
  await expect(page.locator('.scan-dims')).toContainText('5,00 × 4,00 × 2,50', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
});

test('US3: неподдерживаемый файл — понятная ошибка', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', { name: 'scan.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.note--warn')).toContainText(/OBJ|поверхност/);
});

test('US4: толстый ковёр уменьшает RT60', async ({ page }) => {
  await page.goto('/#room');
  const rt = page.locator('.stat__value').first();
  const before = Number((await rt.textContent())!.replace(',', '.').replace(/[^\d.]/g, ''));
  await page.getByLabel('Пол').selectOption('carpet-thick');
  await expect(async () => {
    const after = Number((await rt.textContent())!.replace(',', '.').replace(/[^\d.]/g, ''));
    expect(after).toBeLessThan(before);
  }).toPass();
});

test('002 US1: ручной режим — карта мест слушателя и «Сесть сюда»', async ({ page }) => {
  await page.goto('/#manual');
  await expect(page.locator('.best-list li')).toHaveCount(3, { timeout: 15_000 });
  const before = await page.locator('.topbar__room').textContent();
  await page.locator('.best-list li').first().getByRole('button', { name: 'Сесть сюда' }).click();
  await expect(page.locator('svg.plan .plan__listener')).toBeVisible();
  expect(before).toContain('5,00');
});

test('002 US2: карта мест сабвуфера', async ({ page }) => {
  await page.goto('/#manual');
  await page.getByRole('radio', { name: 'Место сабвуфера' }).click();
  await expect(page.locator('.best-list li').first().getByRole('button', { name: 'Поставить сюда' })).toBeVisible({ timeout: 15_000 });
});

test('002 US3/US5: настройка сабвуфера и эквалайзер', async ({ page }) => {
  await page.goto('/#tuning');
  await page.getByRole('button', { name: 'Подобрать настройки' }).click();
  await expect(page.locator('.tuning-result')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByRole('button', { name: 'Применено' })).toBeVisible();
  await page.getByRole('button', { name: 'Рассчитать фильтры' }).click();
  await expect(page.locator('#eq-apo')).toHaveValue(/Filter 1: ON PK/);
});

test('002 US8: импорт замера REW', async ({ page }) => {
  await page.goto('/#tuning');
  const lines = ['* REW export', ...Array.from({ length: 300 }, (_, i) => { const f = 10 * Math.pow(2, i / 48); return `${f.toFixed(3)} ${(80 + 6 * Math.sin(f / 7)).toFixed(2)} 0`; })];
  await page.setInputFiles('#rew-file', { name: 'rew.txt', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
  await expect(page.getByText(/Расхождение модели и замера/)).toBeVisible();
  await page.getByRole('button', { name: 'Подстроить модель' }).click();
  await expect(page.getByText(/Затухание мод ×/)).toBeVisible({ timeout: 20_000 });
});

test('003: коридор за аркой — моды системы и волновая модель', async ({ page }) => {
  await page.goto('/#room');
  await page.getByRole('button', { name: 'Добавить коридор' }).click();
  await expect(page.locator('.plan__ext').first()).toBeVisible();
  await page.getByRole('button', { name: 'Моды' }).click();
  await expect(page.locator('.sysmodes-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Расстановка' }).click();
  await page.getByRole('radio', { name: 'Вручную' }).click();
  await expect(page.locator('.best-list li').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.model-tag').first()).toContainText('волновая');
});

test('003: скан с коридором — найдены арка и коридор', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-corridor.obj');
  await expect(page.locator('.layout-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Коридор за .* стеной/)).toBeVisible();
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('.topbar__room')).toContainText(/5,00 × (3,99|4,00)/);
});

test('версия приложения видна на экране «Проекты»', async ({ page }) => {
  await page.goto('/#projects');
  await expect(page.locator('.app-version')).toContainText(/Версия от .*\(\w+\)/);
});
