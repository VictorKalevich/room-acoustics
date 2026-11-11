import { test, expect, type Page } from '@playwright/test';

// 020: скан применяется сразу; исходный скан — только в «Поправить границы комнаты»; скан хранится на устройстве.
// 021: начинаем с нового проекта — комнаты ещё нет, выбор файла только в «С чего начать».
test.use({ storageState: { cookies: [], origins: [] } });

const chooseScan = (page: Page) => page.getByRole('button', { name: 'Выбрать файл скана' });

test('скан применяется сразу; «С чего начать» и выбор файла скрыты до «Очистить»; показана модель, а не скан', async ({ page }) => {
  await page.goto('/#room');
  await expect(page.locator('.start-card')).toBeVisible();
  // до выбора скана — ничего, что ещё нельзя посчитать или показать
  await expect(page.locator('.rt-table')).toHaveCount(0);
  await expect(page.locator('#scan-panel')).toHaveCount(0);
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-room.obj');
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50', { timeout: 30_000 });
  await expect(page.locator('.start-card')).toHaveCount(0);
  await expect(chooseScan(page)).toHaveCount(0);
  await expect(page.getByTestId('scan-summary')).toContainText('В модели комнаты: 5,00 × 4,00 × 2,50 м');
  await expect(page.getByText('Комната задана. Проверьте в конструкторе')).toBeVisible();
  // модель комнаты, по которой идут расчёты; исходного скана здесь нет (three.js грузится, когда блок близко к экрану)
  await page.locator('#scan-panel .scan-result').scrollIntoViewIfNeeded();
  await expect(page.locator('#scan-panel .scan-result canvas')).toBeVisible();
  await expect(page.getByText('Исходный скан', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Модель комнаты, по которой идут расчёты/)).toBeVisible();
  // план на обзоре — по скану
  await expect(page.locator('svg.plan:visible').first()).toHaveAttribute('aria-label', /5,00 на 4,00/);
  await page.reload();
  await expect(page.locator('.start-card')).toHaveCount(0);
  await expect(chooseScan(page)).toHaveCount(0);
  // «Очистить» возвращает выбор: вручную или скан
  await page.getByRole('button', { name: 'Очистить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click();
  await expect(page.locator('.start-card')).toBeVisible();
  await expect(chooseScan(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поправить границы комнаты' })).toHaveCount(0);
});

test('поправка границ: исходный скан с рамкой модели; «Отмена» ничего не меняет; после перезагрузки скан берётся с устройства', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-room.obj');
  await expect(page.getByTestId('scan-summary')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
  await expect(page.getByText('Исходный скан', { exact: true })).toBeVisible();
  await expect(page.locator('.layout-editor')).toBeVisible();
  await expect(page.getByText(/правки найденной мебели сбросятся/)).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.layout-editor')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
  // скан сохранён на устройстве: после перезагрузки поправка доступна
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
  await expect(page.locator('.layout-editor')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Исходный скан', { exact: true })).toBeVisible();
  await expect(page.locator('#scan-panel .scan-preview canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('.layout-editor')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
});

test('скан с невозможными размерами не применяется: открыта поправка с предупреждением, комната прежняя', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-hall.obj');
  await expect(page.getByText(/Скан распознан с ошибкой/)).toBeVisible({ timeout: 30_000 });
  // комната не создана: размеров в заголовке нет
  await expect(page.locator('.topbar__room')).not.toContainText('×');
  await expect(page.locator('.start-card')).toBeVisible();
  await expect(page.getByText(/выходит за допустимые размеры/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить размеры' })).toBeDisabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByText(/Скан распознан с ошибкой/)).toHaveCount(0);
  await expect(chooseScan(page)).toBeVisible();
  await expect(page.locator('#scan-panel')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).not.toContainText('×');
});

test('новый скан поверх прежнего сбрасывает комнату, как «Очистить»', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-room.obj');
  await expect(page.getByTestId('scan-summary')).toBeVisible({ timeout: 30_000 });
  await page.goto('/#room/furniture');
  await page.getByRole('button', { name: 'Добавить мебель', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Кровать', exact: true }).click();
  const beds = page.locator('.zone-card select').filter({ has: page.locator('option:checked', { hasText: 'Кровать' }) });
  await expect(beds).toHaveCount(1);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.goto('/#room');
  // кнопки выбора нет, но если файл всё же выбран (например, из другого места), комната начинается заново
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-room-cm.stl');
  await expect(page.locator('.topbar__room')).toContainText('6,20 × 3,80 × 2,70', { timeout: 30_000 });
  await page.goto('/#room/furniture');
  await expect(beds).toHaveCount(0);
});
