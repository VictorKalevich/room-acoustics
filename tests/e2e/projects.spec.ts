import { test, expect, type Page } from '@playwright/test';
import { EMPTY_STATE } from './helpers';

// 023: «Проекты» — возврат назад, сохранение только созданной комнаты, «Новый проект» с предупреждением.
const projects = (page: Page) => page.getByRole('button', { name: 'Проекты' });
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
const exportFile = (page: Page) => page.getByRole('button', { name: 'Экспорт', exact: true });
const newProject = (page: Page) => page.getByRole('button', { name: 'Новый проект' });

test.describe('комнаты ещё нет', () => {
  test.use({ storageState: EMPTY_STATE });

  test('без комнаты сохранить и экспортировать нельзя; «← Назад» и повторное «Проекты» возвращают', async ({ page }) => {
    await page.goto('/#room');
    await projects(page).click();
    await expect(save(page)).toBeDisabled();
    await expect(exportFile(page)).toBeDisabled();
    await expect(page.getByText(/Сохранить и экспортировать проект можно, когда комната создана/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Импорт', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: /Назад/ }).click();
    await expect(page.locator('.start-card')).toBeVisible();
    await projects(page).click();
    await projects(page).click();
    await expect(page.locator('.start-card')).toBeVisible();
    // пустой проект: «Новый проект» без вопроса
    await projects(page).click();
    await newProject(page).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('.start-card')).toBeVisible();
  });

  test('начатая настройка: назад — к тому же шагу; «Новый проект» предупреждает, «Отмена» сохраняет введённое', async ({ page }) => {
    await page.goto('/#room');
    await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
    await page.getByLabel('Глубина', { exact: true }).fill('6');
    await page.getByLabel('Ширина', { exact: true }).fill('4');
    await page.getByLabel('Высота', { exact: true }).fill('2,5');
    await page.getByRole('button', { name: /Далее/ }).click();
    await projects(page).click();
    await expect(save(page)).toBeDisabled();
    await expect(page.getByText(/Настройка комнаты не закончена/)).toBeVisible();
    await page.getByRole('button', { name: /Назад/ }).click();
    await expect(page.getByRole('heading', { name: 'Шаг 2 из 4: Стены' })).toBeVisible();
    await projects(page).click();
    await page.getByRole('button', { name: /Продолжить настройку комнаты/ }).click();
    await expect(page.getByRole('heading', { name: 'Шаг 2 из 4: Стены' })).toBeVisible();
    await projects(page).click();
    await newProject(page).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Открыть новый проект?');
    await expect(dialog).toContainText('настроена не полностью');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await page.getByRole('button', { name: /Назад/ }).click();
    await page.getByRole('button', { name: /Назад/ }).first().click();
    await expect(page.getByLabel('Глубина', { exact: true })).toHaveValue('6');
    await projects(page).click();
    await newProject(page).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Открыть новый проект' }).click();
    await expect(page.locator('.start-card')).toBeVisible();
    await expect(page.locator('.start-card')).not.toContainText('продолжится с шага');
  });
});

test('созданная комната: несохранённый проект — предупреждение; после «Сохранить» — новый проект без вопроса', async ({ page }) => {
  await page.goto('/#room');
  await projects(page).click();
  await expect(save(page)).toBeEnabled();
  await expect(exportFile(page)).toBeEnabled();
  await newProject(page).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Рекомендуем сначала сохранить текущий проект');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
  await save(page).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  await expect(page.locator('.project-list')).toContainText('5,00 × 4,00 × 2,50 м');
  await newProject(page).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('.start-card')).toBeVisible();
  // сохранённый проект открывается из списка
  await projects(page).click();
  await page.locator('.project-list li').first().getByRole('button', { name: 'Открыть' }).click();
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
});
