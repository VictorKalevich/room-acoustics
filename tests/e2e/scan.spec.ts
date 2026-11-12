import { test, expect, type Page } from '@playwright/test';
import { EMPTY_STATE, finishRoomSteps, scanToSteps } from './helpers';

// 020: исходный скан — только в «Поправить границы комнаты»; скан хранится на устройстве.
// 022: скан ведёт в те же шаги, что и ручной ввод; «Сохранить» создаёт комнату; неуверенный скан — сначала поправка.
test.use({ storageState: EMPTY_STATE });

const chooseScan = (page: Page) => page.getByRole('button', { name: 'Выбрать файл скана' });

test('скан ведёт в шаги проверки; после «Сохранить» — обзор с моделью; «Очистить» возвращает «С чего начать»', async ({ page }) => {
  await page.goto('/#room');
  await expect(page.locator('.start-card')).toBeVisible();
  // до выбора скана — ничего, что ещё нельзя посчитать или показать; нижней панели нет
  await expect(page.locator('.rt-table')).toHaveCount(0);
  await expect(page.locator('#scan-panel')).toHaveCount(0);
  await expect(page.locator('.tabbar')).toHaveCount(0);
  await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
  await expect(page.getByText(/Комната распознана по скану «sample-room\.obj»/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Колонки у другой стены' })).toBeVisible();
  // до «Сохранить» комната не создана: размеров в заголовке нет, расчётов нет
  await expect(page.locator('.topbar__room')).not.toContainText('×');
  await expect(page.locator('.tabbar')).toHaveCount(0);
  // уход с шагов — карточка «Скан распознан» с продолжением
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
  await expect(page.locator('.start-card')).toContainText('Скан «sample-room.obj» распознан');
  await page.getByRole('button', { name: 'Проверить комнату' }).click();
  await expect(page.getByRole('heading', { name: 'Шаг 1 из 4: Размеры' })).toBeVisible();
  await finishRoomSteps(page);
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
  await expect(page.locator('.start-card')).toHaveCount(0);
  await expect(chooseScan(page)).toHaveCount(0);
  await expect(page.getByTestId('scan-summary')).toContainText('В модели комнаты: 5,00 × 4,00 × 2,50 м');
  // «Что учтено в расчётах»: геометрия из скана
  await expect(page.locator('.report-table:visible')).toContainText('скан «sample-room.obj», 5,00 × 4,00 × 2,50 м');
  // модель комнаты, по которой идут расчёты; исходного скана здесь нет (three.js грузится, когда блок близко к экрану)
  await page.locator('#scan-panel .scan-result').scrollIntoViewIfNeeded();
  await expect(page.locator('#scan-panel .scan-result canvas')).toBeVisible();
  await expect(page.getByText('Исходный скан', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Модель комнаты, по которой идут расчёты/)).toBeVisible();
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
  await expect(page.locator('.tabbar')).toHaveCount(0);
});

test('поправка границ: исходный скан с рамкой модели; «Отмена» ничего не меняет; после перезагрузки скан берётся с устройства', async ({ page }) => {
  await page.goto('/#room');
  await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
  await finishRoomSteps(page);
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

test('поправка границ во время проверки по шагам: введённое сохраняется, после «Применить размеры» — снова шаги', async ({ page }) => {
  await page.goto('/#room');
  await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
  await page.getByRole('button', { name: /Далее/ }).click();
  await page.getByLabel('Материал стены', { exact: true }).selectOption('gypsum');
  await page.getByRole('button', { name: /Назад/ }).click();
  await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
  await expect(page.locator('.layout-editor')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.getByRole('heading', { name: 'Шаг 1 из 4: Размеры' })).toBeVisible();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByLabel('Материал стены', { exact: true })).toHaveValue('gypsum');
});

test('скан с невозможными размерами не применяется: открыта поправка с предупреждением, комнаты нет', async ({ page }) => {
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

test('неуверенный скан (< 50 %): сначала «Поправить границы», «Применить размеры» ведёт в шаги', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-low.obj');
  await expect(page.getByText(/Скан распознан неуверенно \(\d+ %\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.layout-editor')).toBeVisible();
  await expect(page.locator('.topbar__room')).not.toContainText('×');
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.getByRole('heading', { name: 'Шаг 1 из 4: Размеры' })).toBeVisible();
});

test('новый скан поверх прежнего сбрасывает комнату, как «Очистить»', async ({ page }) => {
  await page.goto('/#room');
  await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
  await finishRoomSteps(page);
  await page.goto('/#room/furniture');
  await page.getByRole('button', { name: 'Добавить мебель', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Кровать', exact: true }).click();
  const beds = page.locator('.zone-card select').filter({ has: page.locator('option:checked', { hasText: 'Кровать' }) });
  await expect(beds).toHaveCount(1);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.goto('/#room');
  // кнопки выбора нет, но если файл всё же выбран (например, из другого места), комната начинается заново
  await scanToSteps(page, 'tests/fixtures/out/sample-room-cm.stl');
  await expect(page.getByLabel('Глубина', { exact: true })).toHaveValue('6,2');
  await finishRoomSteps(page);
  await expect(page.locator('.topbar__room')).toContainText('6,20 × 3,80 × 2,70');
  await page.goto('/#room/furniture');
  await expect(beds).toHaveCount(0);
});

test('026: границы скана откатываются вместе с проектом — поправка после возврата к сохранённой версии начинается с его границ', async ({ page }) => {
  await page.goto('/#room');
  await scanToSteps(page, 'tests/fixtures/out/sample-room.obj');
  await finishRoomSteps(page);
  const openProjects = async () => {
    await page.getByRole('button', { name: 'Открыть меню' }).click();
    await page.locator('.drawer__item', { hasText: 'Проекты' }).click();
  };
  await openProjects();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  await page.evaluate(() => { location.hash = 'room'; });

  // сдвигаем левую стену внутрь и применяем: комната стала уже
  await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
  const dims = page.locator('.layout-editor__dims');
  await expect(dims).toHaveText('5,00 × 4,00 м', { timeout: 15_000 });
  const handle = page.locator('.layout-editor__handle').nth(2);
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(dims).not.toHaveText('5,00 × 4,00 м');
  const narrowed = (await dims.textContent())!;
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('.layout-editor')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).not.toContainText('5,00 × 4,00 × 2,50');

  // возврат к сохранённой версии: комната снова 5 × 4
  await openProjects();
  await page.locator('.project-list li').first().getByRole('button', { name: 'Открыть' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Вернуться', exact: true }).click();
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
  const plan = page.locator('svg.plan:visible').first();
  const before = await plan.innerHTML();

  // поправка открывается с границами проекта (а не с более поздними, сохранёнными вместе со сканом);
  // «Применить» без изменений ничего не сдвигает
  await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
  await expect(dims).toHaveText('5,00 × 4,00 м', { timeout: 15_000 });
  expect(narrowed).not.toBe('5,00 × 4,00 м');
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('.layout-editor')).toHaveCount(0);
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50');
  expect(await plan.innerHTML()).toBe(before);
});
