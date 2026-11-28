// V2-021–V2-025: редактор модели — план, выбор и перемещение (клавиши, перетаскивание), точный ввод, зеркало,
// блокировка, добавление, слои, проверка расстановки, отмена и повтор, разделы и уровни сложности, сохранение.
import { test, expect, type Page } from '@playwright/test';

async function start(page: Page, level = 'Простой') {
  await page.goto('./');
  await page.getByRole('radio', { name: new RegExp(level) }).check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Акустика вашей комнаты' })).toBeVisible();
}

async function createRoom(page: Page) {
  await page.goto('./#/rooms/new/manual');
  await page.getByLabel('Название').fill('Студия');
  for (const [label, v] of [['Длина', '4,5'], ['Ширина', '3,8'], ['Высота', '2,7']] as const) {
    await page.getByLabel(label, { exact: true }).fill(v);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Модель' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.al-plan__object').first()).toBeVisible();
}

const obj = (page: Page, name: string) => page.locator('.al-plan__object').filter({ has: page.locator(`xpath=self::*[starts-with(@aria-label, "${name}")]`) });
const props = (page: Page) => page.getByTestId('properties');

test('059 · план: выбор, клавиши, точный ввод, зеркало, блокировка, отмена и повтор, сохранение', async ({ page }) => {
  await start(page);
  await createRoom(page);
  for (const name of ['L (колонка)', 'R (колонка)', 'Сабвуфер 1 (сабвуфер)', 'Основное место (слушатель)']) await expect(obj(page, name)).toHaveCount(1);

  const left = obj(page, 'L (колонка)');
  const before = await left.getAttribute('aria-label');
  await left.focus();
  await page.keyboard.press('Enter');
  await expect(props(page).getByLabel('X — от передней стены')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(left).not.toHaveAttribute('aria-label', before!);
  const moved = await left.getAttribute('aria-label');
  await page.getByRole('button', { name: 'Отменить: Перемещение' }).click();
  await expect(left).toHaveAttribute('aria-label', before!);
  await page.getByRole('button', { name: 'Повторить: Перемещение' }).click();
  await expect(left).toHaveAttribute('aria-label', moved!);

  const y = props(page).getByLabel('Y — от левой стены');
  await y.fill('0,9');
  await y.press('Enter');
  await expect(left).toHaveAttribute('aria-label', /y 0,90 м/);
  await props(page).getByRole('button', { name: 'Зеркально для «Правая колонка»' }).click();
  await expect(obj(page, 'R (колонка)')).toHaveAttribute('aria-label', /y 2,90 м/);

  await props(page).getByRole('switch', { name: 'Закрепить' }).click();
  await expect(left).toHaveAttribute('aria-label', /закреплён/);
  const locked = await left.getAttribute('aria-label');
  await left.focus();
  await page.keyboard.press('ArrowRight');
  await expect(left).toHaveAttribute('aria-label', locked!);

  await page.reload();
  await expect(obj(page, 'L (колонка)')).toHaveAttribute('aria-label', /y 0,90 м.*закреплён/);
  await expect(obj(page, 'R (колонка)')).toHaveAttribute('aria-label', /y 2,90 м/);
});

test('059 · план: перетаскивание с привязкой, добавление, слои, проверка расстановки', async ({ page }) => {
  await start(page);
  await createRoom(page);
  const listener = obj(page, 'Основное место (слушатель)');
  // уведомление о создании комнаты внизу экрана не должно оказаться под указателем
  await listener.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await listener.locator('.al-plan__listener').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect(listener).toHaveAttribute('aria-label', /x \d,\d[05] м, y \d,\d[05] м/);
  await expect(page.getByRole('button', { name: 'Отменить: Перемещение' })).toBeEnabled();

  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Добавить на план' });
  await sheet.getByRole('button', { name: 'Шкаф' }).click();
  await expect(sheet).toHaveCount(0);
  const wardrobe = obj(page, 'Шкаф (интерьер)');
  await expect(wardrobe).toHaveAttribute('aria-pressed', 'true');
  await expect(props(page).getByLabel('Тип')).toHaveValue('wardrobe');

  await props(page).getByLabel('Центр, X').fill('0,5');
  await props(page).getByLabel('Центр, X').press('Enter');
  await props(page).getByLabel('Центр, Y').fill('0,6');
  await props(page).getByLabel('Центр, Y').press('Enter');
  await expect(page.getByText(/Проверка расстановки: \d/)).toBeVisible();
  await expect(page.getByText('Левая колонка стоит на месте предмета «Шкаф».')).toBeVisible();

  await page.getByRole('button', { name: 'Закрыть свойства' }).click();
  await page.getByRole('checkbox', { name: 'Интерьер' }).uncheck();
  await expect(wardrobe).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Интерьер' }).check();
  await expect(wardrobe).toHaveCount(1);

  await page.getByRole('switch', { name: 'Симметрично для пары колонок' }).click();
  const right = obj(page, 'R (колонка)');
  await expect(right).toHaveAttribute('aria-label', /y 2,85 м/);
  await obj(page, 'L (колонка)').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-label', /y 2,90 м/);
  await expect(page.getByRole('button', { name: 'Отменить: Симметричное перемещение' })).toBeEnabled();

  await page.getByRole('radio', { name: 'Сбоку' }).click();
  await expect(page.locator('.al-plan__svg')).toHaveAttribute('aria-label', /Вид сбоку/);
});

test('059 · разделы модели: помещение, проёмы, система, обработка; уровни и скрытые параметры', async ({ page }) => {
  await start(page, 'Продвинутый');
  await createRoom(page);
  await page.getByRole('link', { name: 'Помещение' }).click();
  await expect(page).toHaveURL(/#\/rooms\/[^/]+\/model\/geometry$/);
  const depth = page.getByLabel('Длина (от передней стены к задней)');
  await depth.fill('6');
  await depth.press('Enter');
  await expect(depth).toHaveValue('6');
  await page.getByLabel('Пол').selectOption('carpet-thick');
  await page.getByLabel('Стена для нового').selectOption('left');
  await page.getByRole('button', { name: 'Дверь', exact: true }).click();
  await page.getByRole('button', { name: /Дверь — левая стена/ }).click();
  await page.getByTestId('properties').getByLabel('Состояние').selectOption('open');
  await expect(page.getByRole('button', { name: /Дверь — левая стена/ })).toContainText('Открыто');
  await page.getByRole('switch', { name: 'Есть скос' }).click();
  await expect(page.getByLabel('Высота у стены')).toBeVisible();

  await page.getByRole('link', { name: 'Модель: обзор' }).click();
  await page.getByRole('link', { name: 'Аудиосистема' }).click();
  await page.getByRole('radio', { name: '2.2' }).click();
  await expect(page.getByRole('list', { name: 'Источники' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Добавить сабвуфер' }).click();
  await expect(page.getByRole('list', { name: 'Источники' }).getByText('Сабвуфер 3')).toBeVisible();
  await expect(page.getByText('Произвольная схема: состав изменён вручную.')).toBeVisible();

  await page.getByRole('link', { name: 'Модель: обзор' }).click();
  await page.getByRole('link', { name: 'Обработка' }).click();
  await page.getByRole('button', { name: 'Диффузор' }).click();
  await page.getByRole('button', { name: /Диффузор/ }).filter({ hasText: 'Вне расчёта' }).click();
  await expect(page.getByTestId('properties').getByText(/пока не входит в расчёт ядра/)).toBeVisible();

  await page.getByRole('link', { name: 'Модель: обзор' }).click();
  await page.getByRole('link', { name: 'Параметры расчёта' }).click();
  const temp = page.getByLabel('Температура воздуха');
  await temp.fill('25');
  await temp.press('Enter');
  await page.goto('./#/settings');
  await page.getByRole('radiogroup', { name: 'Уровень сложности' }).getByRole('radio', { name: 'Простой' }).click();
  await page.goBack();
  await expect(page.getByText('Скрытые параметры изменены')).toBeVisible();
  await expect(page.getByLabel('Температура воздуха')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сбросить к значениям по умолчанию' }).click();
  await expect(page.getByText('Скрытые параметры изменены')).toHaveCount(0);
});
