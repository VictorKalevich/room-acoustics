import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { EMPTY_STATE } from './helpers';

// 023: «Проекты» — возврат назад, сохранение только созданной комнаты; «Новый проект», «Открыть» и «Импорт»
// предупреждают, если введённое пропадёт. 024: «Проекты» — в меню, вместе с импортом и экспортом.
const projects = async (page: Page) => {
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.locator('.drawer__item', { hasText: 'Проекты' }).click();
};
const jsonFile = (data: unknown) => ({ name: 'room.roomacoustics.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
const exportFile = (page: Page) => page.getByRole('button', { name: 'Экспорт', exact: true });
const newProject = (page: Page) => page.getByRole('button', { name: 'Новый проект' });

test.describe('комнаты ещё нет', () => {
  test.use({ storageState: EMPTY_STATE });

  test('без комнаты сохранить и экспортировать нельзя; «Создать комнату» ведёт на старт', async ({ page }) => {
    await page.goto('/#room');
    await projects(page);
    await expect(save(page)).toBeDisabled();
    await expect(exportFile(page)).toBeDisabled();
    await expect(page.getByText(/Сохранить и экспортировать проект можно, когда комната создана/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Импорт', exact: true })).toBeEnabled();
    // 025: «← Назад» убрана — вернуться можно пунктом меню «Начать» или ссылкой на комнату
    await expect(page.getByRole('button', { name: /Назад/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Создать комнату/ }).click();
    await expect(page.locator('.start-card')).toBeVisible();
    // пустой проект: «Новый проект» без вопроса
    await projects(page);
    await newProject(page).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('.start-card')).toBeVisible();
  });

  test('начатая настройка: «Продолжить настройку» — к тому же шагу; «Новый проект» предупреждает, «Отмена» сохраняет введённое', async ({ page }) => {
    await page.goto('/#room');
    await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
    await page.getByLabel('Глубина', { exact: true }).fill('6');
    await page.getByLabel('Ширина', { exact: true }).fill('4');
    await page.getByLabel('Высота', { exact: true }).fill('2,5');
    await page.getByRole('button', { name: /Далее/ }).click();
    await projects(page);
    await expect(save(page)).toBeDisabled();
    await expect(page.getByText(/Настройка комнаты не закончена/)).toBeVisible();
    await page.getByRole('button', { name: /Продолжить настройку комнаты/ }).click();
    await expect(page.getByRole('heading', { name: 'Шаг 2 из 4: Стены' })).toBeVisible();
    await projects(page);
    await newProject(page).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Открыть новый проект?');
    await expect(dialog).toContainText('настроена не полностью');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await page.getByRole('button', { name: /Продолжить настройку комнаты/ }).click();
    await page.getByRole('button', { name: /Назад/ }).first().click();
    await expect(page.getByLabel('Глубина', { exact: true })).toHaveValue('6');
    await projects(page);
    await newProject(page).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Открыть новый проект' }).click();
    await expect(page.locator('.start-card')).toBeVisible();
    await expect(page.locator('.start-card')).not.toContainText('продолжится с шага');
  });
});

test('созданная комната: несохранённый проект — предупреждение; после «Сохранить» — новый проект без вопроса', async ({ page }) => {
  await page.goto('/#room');
  await projects(page);
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
  await projects(page);
  await page.locator('.project-list li').first().getByRole('button', { name: 'Открыть' }).click();
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
});

test('«Открыть» из списка: изменения после сохранения и начатая настройка — предупреждение', async ({ page }) => {
  await page.goto('/#room');
  await projects(page);
  const name = page.locator('#pname');
  const saved = await name.inputValue();
  await save(page).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  const row = page.locator('.project-list li').first();
  // тот же проект изменён после сохранения: откроется сохранённая версия
  await name.fill('Изменённое название');
  await row.getByRole('button', { name: 'Открыть' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Вернуться к сохранённой версии?');
  await expect(dialog).toContainText('Изменения после последнего сохранения пропадут');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(name).toHaveValue('Изменённое название');
  await row.getByRole('button', { name: 'Открыть' }).click();
  await dialog.getByRole('button', { name: 'Вернуться', exact: true }).click();
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
  await projects(page);
  await expect(name).toHaveValue(saved);
  // сохранённый и не изменённый — новый проект без вопроса; начатая в нём настройка — с вопросом
  await newProject(page).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.start-card').getByRole('button', { name: 'Настроить комнату вручную' }).click();
  await page.getByLabel('Глубина', { exact: true }).fill('6');
  await projects(page);
  await row.getByRole('button', { name: 'Открыть' }).click();
  await expect(dialog).toContainText(`Открыть проект «${saved}»?`);
  await expect(dialog).toContainText('настроена не полностью');
  await dialog.getByRole('button', { name: 'Открыть проект' }).click();
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
});

test('«Импорт»: несохранённый проект — предупреждение; после «Сохранить» — без вопроса', async ({ page }) => {
  await page.goto('/#room');
  await projects(page);
  const name = page.locator('#pname');
  const current = await name.inputValue();
  const [download] = await Promise.all([page.waitForEvent('download'), exportFile(page).click()]);
  const data = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  data.project = { ...data.project, id: 'from-file', name: 'Комната из файла' };
  const file = jsonFile(data);
  const input = page.locator('input[type=file][accept^=".json"]');
  await input.setInputFiles(file);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Открыть проект «Комната из файла» из файла?');
  await expect(dialog).toContainText('Рекомендуем сначала сохранить текущий проект');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(name).toHaveValue(current);
  await save(page).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  await input.setInputFiles(file);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
  await projects(page);
  await expect(name).toHaveValue('Комната из файла');
});

test('024: «Проекты» в меню вместо «Импорт и экспорт»; экспорт запоминается; старая версия из файла — с вопросом', async ({ page }) => {
  await page.goto('/#room');
  await expect(page.locator('.topbar').getByRole('button', { name: 'Проекты' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.locator('.drawer__label', { hasText: /^Импорт и экспорт$/ })).toHaveCount(0);
  await expect(page.locator('.drawer__label', { hasText: /^Проекты$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await projects(page);
  // версия и установка — в «О приложении», здесь только файлы проекта
  await expect(page.locator('.app-version')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Импорт и экспорт' })).toBeVisible();
  await save(page).click();
  const [download] = await Promise.all([page.waitForEvent('download'), exportFile(page).click()]);
  await expect(page.getByText('Файл проекта передан')).toBeVisible();
  await expect(page.getByText(/Последний экспорт в файл:/)).toBeVisible();
  // тот же проект, более старая версия: спрашивает, хотя текущий сохранён
  const data = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  data.project = { ...data.project, name: 'Старая версия', updatedAt: '2020-01-01T10:00:00.000Z' };
  const input = page.locator('input[type=file][accept^=".json"]');
  await input.setInputFiles(jsonFile(data));
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Открыть версию из файла?');
  await expect(dialog).toContainText('более старая версия этого проекта');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.locator('#pname')).not.toHaveValue('Старая версия');
  await input.setInputFiles(jsonFile(data));
  await dialog.getByRole('button', { name: 'Открыть проект' }).click();
  await expect(page.locator('.topbar__room')).toContainText('Старая версия, 5,00 × 4,00 × 2,50');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.locator('.drawer__item', { hasText: 'О приложении' }).click();
  await expect(page.locator('.app-version')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Установить на iPhone' })).toBeVisible();
});
