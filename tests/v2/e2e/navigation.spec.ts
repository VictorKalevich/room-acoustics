// V2-016–V2-020: первый запуск, главная, комнаты, инструменты, «Мои данные», настройки, маршруты и «Назад».
import { test, expect, type Page } from '@playwright/test';

const mobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const nav = (page: Page, name: string) => (mobile(page) ? page.locator('.al-tabbar') : page.locator('.al-sidebar')).getByRole('link', { name });

async function start(page: Page, level = 'Простой') {
  await page.goto('./');
  await page.getByRole('radio', { name: new RegExp(level) }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Акустика вашей комнаты' })).toBeVisible();
}

async function createRoom(page: Page, name: string, dims: [string, string, string]) {
  await page.goto('./#/rooms/new');
  await page.getByLabel('Название').fill(name);
  for (const [label, v] of [['Длина', dims[0]], ['Ширина', dims[1]], ['Высота', dims[2]]] as const) {
    await page.getByLabel(label, { exact: true }).fill(v);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Модель' })).toHaveAttribute('aria-selected', 'true');
}

test('059 · первый запуск: выбранный уровень запоминается и меняется в настройках', async ({ page }) => {
  await start(page, 'Продвинутый');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Акустика вашей комнаты' })).toBeVisible();
  await nav(page, 'Настройки').click();
  const level = page.getByRole('radiogroup', { name: 'Уровень сложности' });
  await expect(level.getByRole('radio', { name: 'Продвинутый' })).toHaveAttribute('aria-checked', 'true');
  await level.getByRole('radio', { name: 'Экспертный' }).click();
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Уровень сложности' }).getByRole('radio', { name: 'Экспертный' })).toHaveAttribute('aria-checked', 'true');
});

test('059 · комната: создание с запятой и проверкой размеров, активная на главной, копия, переименование, удаление', async ({ page }) => {
  await start(page);
  await page.getByRole('link', { name: 'Создать комнату' }).first().click();
  await expect(page.getByLabel('Начальная аудиосистема')).toHaveCount(0);
  const depth = page.getByLabel('Длина', { exact: true });
  await depth.fill('0,5');
  await depth.press('Tab');
  await expect(page.getByText('Не меньше 1 м.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Отмена' }).click();

  await createRoom(page, '', ['4,5', '3,8', '2,7']);
  await expect(page.locator('.al-topbar__title')).toHaveText('Комната 1');
  await expect(page.getByText('4,5 × 3,8 × 2,7 м')).toBeVisible();

  await nav(page, 'Главная').click();
  await expect(page.getByText('Активная комната')).toBeVisible();
  await expect(page.getByText('46,2 м³')).toBeVisible();

  await nav(page, 'Комнаты').click();
  const row = page.getByRole('listitem').filter({ hasText: 'Комната 1' });
  await expect(row.getByText('Активная')).toBeVisible();
  await row.getByRole('button', { name: 'Копия «Комната 1»' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Комната 1 (копия)' })).toBeVisible();

  await page.getByRole('button', { name: 'Переименовать «Комната 1 (копия)»' }).click();
  await page.getByRole('dialog').getByLabel('Название').fill('Студия');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Студия' })).toBeVisible();

  await page.getByRole('button', { name: 'Удалить «Студия»' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Удалить «Студия»?' });
  await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Студия' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Комната 1' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Комната 1' })).toBeVisible();
});

test('059 · комната: вкладки — адреса, «Назад» и «Вперёд» браузера, неизвестный адрес', async ({ page }) => {
  await start(page);
  await createRoom(page, 'Гостиная', ['5', '4', '2,5']);
  const url = page.url();
  await page.getByRole('tab', { name: 'Анализ' }).click();
  await expect(page).toHaveURL(/\/analysis$/);
  await page.getByRole('tab', { name: 'Советы' }).click();
  await expect(page).toHaveURL(/\/advice$/);
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Анализ' })).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page.getByRole('tab', { name: 'Советы' })).toHaveAttribute('aria-selected', 'true');
  await page.goto(url.replace(/#.*/, '#/rooms/nope-404'));
  await expect(page.getByRole('heading', { name: 'Комната не найдена' })).toBeVisible();
  await page.goto(url.replace(/#.*/, '#/what/is/this'));
  await expect(page.getByText('Такой страницы нет')).toBeVisible();
  await page.getByRole('link', { name: 'На главную' }).click();
  await expect(page.getByText('Активная комната')).toBeVisible();
});

test('059 · инструменты: 23 в пяти категориях, поиск, избранное, недавние', async ({ page }) => {
  await start(page);
  await nav(page, 'Инструменты').click();
  await expect(page.locator('[data-tool]')).toHaveCount(23);
  await page.getByLabel('Поиск инструмента').fill('моды');
  await expect(page.getByRole('heading', { name: /Найдено: \d/ })).toBeVisible();
  await expect(page.locator('[data-tool="room-modes"]')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить «Комнатные моды» в избранное' }).click();
  await page.getByLabel('Поиск инструмента').fill('');
  await expect(page.getByRole('heading', { name: 'Избранное' })).toBeVisible();
  await page.locator('[data-tool="sbir"]').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Провалы SBIR' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Недавние' })).toBeVisible();
  await nav(page, 'Главная').click();
  await expect(page.getByRole('heading', { name: 'Избранные и недавние инструменты' })).toBeVisible();
  await page.goto('./#/tools/unknown-tool');
  await expect(page.getByText('Такого инструмента нет')).toBeVisible();
});

test('059 · «Мои данные»: девять категорий, пустая категория; настройки: хранилище и перенос', async ({ page }) => {
  await start(page);
  await nav(page, mobile(page) ? 'Данные' : 'Мои данные').click();
  await expect(page.locator('.al-tile')).toHaveCount(9);
  await page.getByRole('link', { name: 'Тестовые сигналы' }).click();
  await expect(page.getByText('Пока пусто')).toBeVisible();
  await nav(page, 'Настройки').click();
  await expect(page.getByRole('button', { name: 'Сохранить резервную копию' })).toBeVisible();
  await page.getByRole('button', { name: 'Найти на этом устройстве' }).click();
  await expect(page.getByText('Хранилище прежней версии на этом адресе сайта не найдено', { exact: false })).toBeVisible();
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).toEqual(['room-acoustics-v2']);
});

test('059 · навигация: боковая панель на широком экране, нижняя — на узком; фокус переходит к содержимому', async ({ page }) => {
  await start(page);
  if (mobile(page)) {
    await expect(page.locator('.al-tabbar')).toBeVisible();
    await expect(page.locator('.al-sidebar')).toBeHidden();
  } else {
    await expect(page.locator('.al-sidebar')).toBeVisible();
    await expect(page.locator('.al-tabbar')).toBeHidden();
  }
  await nav(page, 'Инструменты').click();
  await expect(page.locator('#main')).toBeFocused();
  await expect(nav(page, 'Инструменты')).toHaveAttribute('aria-current', 'page');
});
