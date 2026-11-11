import { test, expect } from '@playwright/test';

// 021: пока комната не создана, на экране «Комната» только «С чего начать», расчёты предлагают сначала
// создать комнату. Ручная настройка идёт по шагам, введённое хранится черновиком до «Сохранить».
test.use({ storageState: { cookies: [], origins: [] } });

const heading = (page: import('@playwright/test').Page, name: string | RegExp) => page.getByRole('heading', { name });

test('до создания комнаты — только «С чего начать»; экраны с расчётами ведут к комнате', async ({ page }) => {
  await page.goto('/#room');
  await expect(page.locator('.start-card')).toBeVisible();
  await expect(page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Очистить' })).toHaveCount(0);
  await expect(page.locator('.rt-table')).toHaveCount(0);
  await expect(page.locator('svg.plan:visible')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).toHaveText('Моя комната');
  for (const route of ['analysis', 'placement', 'tuning/eq', 'measure/compare', 'voice', 'report']) {
    await page.goto(`/#${route}`);
    await expect(heading(page, 'Сначала создайте комнату')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Перейти к комнате' }).click();
  await expect(page).toHaveURL(/#room$/);
  await expect(page.locator('.start-card')).toBeVisible();
});

test('ручная настройка: шаги по порядку, черновик переживает перезапуск и сбрасывается, «Сохранить» создаёт комнату', async ({ page }) => {
  await page.goto('/#room');
  await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
  await expect(heading(page, 'Шаг 1 из 4: Размеры')).toBeVisible();
  await expect(page.getByLabel('Глубина', { exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Шаги конструктора' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Назад/ })).toHaveCount(0);
  await page.getByLabel('Глубина', { exact: true }).fill('6');
  await page.getByLabel('Глубина', { exact: true }).blur();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(heading(page, 'Шаг 2 из 4: Стены')).toBeVisible();
  // по адресу дальше достигнутого шага не попасть
  await page.goto('/#room/furniture');
  await expect(heading(page, 'Шаг 2 из 4: Стены')).toBeVisible();
  // уход без вопроса, черновик остаётся и после перезапуска
  await page.getByRole('button', { name: 'Расстановка' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(heading(page, 'Сначала создайте комнату')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Перейти к комнате' }).click();
  await expect(page.locator('.start-card')).toContainText('продолжится с шага «Стены»');
  await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
  await expect(heading(page, 'Шаг 2 из 4: Стены')).toBeVisible();
  await page.getByRole('button', { name: /Назад/ }).click();
  await expect(page.getByLabel('Глубина', { exact: true })).toHaveValue('6');
  // «Сбросить черновик» — на каждом шаге; после него настройка начинается заново
  await page.getByRole('button', { name: 'Сбросить черновик' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Сбросить черновик' }).click();
  await expect(heading(page, 'Шаг 1 из 4: Размеры')).toBeVisible();
  await expect(page.getByLabel('Глубина', { exact: true })).toHaveValue('5');
  await page.getByLabel('Глубина', { exact: true }).fill('5,5');
  await page.getByLabel('Глубина', { exact: true }).blur();
  for (const name of ['Стены', 'Пол и потолок', 'Мебель']) {
    await page.getByRole('button', { name: /Далее/ }).click();
    await expect(heading(page, new RegExp(`из 4: ${name}$`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сбросить черновик' })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /Далее/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/#room$/);
  await expect(page.locator('.start-card')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).toContainText('5,50 × 4,00 × 2,50');
  // комната, настроенная вручную, — «3D-модель» без упоминаний скана
  await expect(page.locator('#scan-panel .panel__title')).toHaveText('3D-модель');
  await expect(page.locator('#scan-panel')).not.toContainText(/LiDAR|скан/i);
  await page.goto('/#analysis');
  await expect(heading(page, 'Сначала создайте комнату')).toHaveCount(0);
  // после перезапуска комната остаётся созданной, конструктор — в режиме правки
  await page.waitForTimeout(800);
  await page.reload();
  await page.goto('/#room/walls');
  await expect(page.getByRole('navigation', { name: 'Шаги конструктора' })).toBeVisible();
});
