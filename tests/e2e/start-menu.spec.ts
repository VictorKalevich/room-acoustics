import { test, expect, type Page } from '@playwright/test';
import { EMPTY_STATE, scanToSteps } from './helpers';

// 025: «Начать» — выделенный пункт меню, пока комната не создана; ведёт на «С чего начать» с любого экрана меню.
const openMenu = (page: Page) => page.getByRole('button', { name: 'Открыть меню' }).click();
const startItem = (page: Page) => page.locator('.drawer__item--start');
const closeMenu = (page: Page) => page.getByRole('button', { name: 'Закрыть меню' }).click();
const menuItem = (page: Page, label: string) => page.locator('.drawer__item', { has: page.locator('.drawer__label', { hasText: new RegExp(`^${label}$`) }) });

test.describe('комнаты ещё нет', () => {
  test.use({ storageState: EMPTY_STATE });

  test('«Начать» возвращает на старт с экранов меню; подсказка — с какого шага продолжится; после «Сохранить» пункта нет, после «Очистить» — снова есть', async ({ page }) => {
    await page.goto('/#room');
    await openMenu(page);
    await expect(startItem(page)).toBeVisible();
    await expect(startItem(page)).toContainText('Первый шаг — комната');
    // выделен и стоит первым, над группами
    await expect(page.locator('.drawer__item').first()).toHaveClass(/drawer__item--start/);
    await closeMenu(page);
    for (const label of ['Проекты', 'Помощник и словарь', 'О приложении']) {
      await openMenu(page);
      await menuItem(page, label).click();
      await expect(page.locator('.start-card')).toBeHidden();
      await openMenu(page);
      await startItem(page).click();
      await expect(page.locator('.start-card')).toBeVisible();
    }
    // начатая ручная настройка: подсказка называет шаг, «Начать» — на старт с продолжением
    await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
    await page.getByLabel('Глубина', { exact: true }).fill('5');
    await page.getByLabel('Ширина', { exact: true }).fill('4');
    await page.getByLabel('Высота', { exact: true }).fill('2,5');
    await page.getByRole('button', { name: /Далее/ }).click();
    await openMenu(page);
    await expect(startItem(page)).toContainText('продолжится с шага «Стены»');
    await startItem(page).click();
    await expect(page.locator('.start-card')).toContainText('продолжится с шага «Стены»');
    await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
    await expect(page.getByRole('heading', { name: 'Шаг 2 из 4: Стены' })).toBeVisible();
    // комната создана — пункта нет, есть нижняя панель
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /Далее/ }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toBeVisible();
    await openMenu(page);
    await expect(startItem(page)).toHaveCount(0);
    await expect(menuItem(page, 'Измерения')).toBeVisible();
    await closeMenu(page);
    // «Очистить» — комнаты снова нет, «Начать» вернулся
    await page.getByRole('button', { name: 'Очистить' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click();
    await expect(page.locator('.start-card')).toBeVisible();
    await openMenu(page);
    await expect(startItem(page)).toContainText('Первый шаг — комната');
  });
});

test('созданная комната: «Начать» нет; «Новый проект» — пункт снова есть', async ({ page }) => {
  await page.goto('/#room');
  await openMenu(page);
  await expect(startItem(page)).toHaveCount(0);
  await menuItem(page, 'Проекты').click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await expect(page.locator('.start-card')).toBeVisible();
  await openMenu(page);
  await expect(startItem(page)).toBeVisible();
  await expect(startItem(page)).toHaveAttribute('aria-current', 'page');
});

test.describe('скан', () => {
  test.use({ storageState: EMPTY_STATE });

  test('скан распознан, но не сохранён: подсказка «Начать» — проверить по шагам', async ({ page }) => {
    await page.goto('/#room');
    await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
    await openMenu(page);
    await expect(startItem(page)).toContainText('Скан распознан');
  });
});
