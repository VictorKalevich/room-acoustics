import { test, expect, type Page } from '@playwright/test';

// 019: конструктор комнаты — шаги, развёртка стены, ковры и шторы, мебель по списку.

const steps = (page: Page) => page.getByRole('navigation', { name: 'Шаги конструктора' });
const rtCell = (page: Page, i: number) => page.locator('.rt-table tbody td').nth(i);

test('шаги открываются по адресу, переживают перезагрузку и «Назад»; #room — обзор', async ({ page }) => {
  await page.goto('/#room/walls');
  await expect(page.locator('.topbar__title')).toHaveText('Конструктор комнаты');
  await expect(steps(page).getByRole('button', { name: /Стены/ })).toHaveAttribute('aria-current', 'page');
  await steps(page).getByRole('button', { name: /Мебель/ }).click();
  await expect(page).toHaveURL(/#room\/furniture$/);
  await page.reload();
  await expect(steps(page).getByRole('button', { name: /Мебель/ })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(steps(page).getByRole('button', { name: /Стены/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
  await expect(page).toHaveURL(/#room$/);
  await expect(page.locator('.topbar__title')).toHaveText('Комната');
  await expect(page.getByRole('button', { name: 'Конструктор комнаты' })).toBeVisible();
});

test('развёртка показывает только элементы выбранной стены; шторы закрывают окно; мебель у стены видна', async ({ page }) => {
  await page.goto('/#room/walls');
  const view = page.locator('svg.wall-view');
  await expect(view).toHaveAttribute('aria-label', /Передняя стена: длина 4,00 м, высота 2,50 м/);
  await page.getByRole('button', { name: 'Добавить проём', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Окно', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить на стену', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Шторы', exact: true }).click();
  await expect(view.locator('.wall-view__window')).toHaveCount(1);
  await expect(view.locator('.wall-view__curtain')).toHaveCount(1);
  const curtain = page.locator('.zone-card').filter({ hasText: 'Шторы 1' });
  // окно 1,35–2,65 м, низ 0,9, верх 2,3 → шторы 1,2–2,8 м от пола до 2,45 м
  await expect(curtain.getByLabel('Отступ', { exact: true })).toHaveValue('1,2');
  await expect(curtain.getByLabel('Ширина', { exact: true })).toHaveValue('1,6');
  await expect(curtain.getByLabel('Верх', { exact: true })).toHaveValue('2,45');
  await curtain.getByLabel('Шторы 1: вид', { exact: true }).selectOption('light');
  await expect(curtain).toContainText('Лёгкие шторы почти не поглощают звук');
  // задняя стена: окна и штор передней не видно
  await page.getByRole('radio', { name: 'Задняя', exact: true }).click();
  await expect(view).toHaveAttribute('aria-label', /Задняя стена/);
  await expect(view.locator('.wall-view__window, .wall-view__curtain')).toHaveCount(0);
  await expect(page.getByText('На этой стене нет окон, дверей и проёмов.')).toBeVisible();
  // шкаф у задней стены появляется силуэтом
  await steps(page).getByRole('button', { name: /Мебель/ }).click();
  await page.getByRole('button', { name: 'Добавить мебель', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Шкаф (МДФ)', exact: true }).click();
  const card = page.locator('.zone-card').filter({ hasText: 'В расчёте звука не учитывается' });
  await card.getByLabel('От передней стены', { exact: true }).fill('4,4');
  await card.getByLabel('От передней стены', { exact: true }).blur();
  await steps(page).getByRole('button', { name: /Стены/ }).click();
  await page.getByRole('radio', { name: 'Задняя', exact: true }).click();
  await expect(view.locator('.wall-view__furniture')).toContainText('Шкаф (МДФ)');
});

test('ковры видны на шаге «Пол и потолок» и не видны на плане мебели', async ({ page }) => {
  await page.goto('/#room/floor');
  await page.getByRole('button', { name: 'Добавить ковёр', exact: true }).click();
  await expect(page.locator('svg.plan:visible .plan__rug')).toHaveCount(1);
  await expect(page.locator('.plan-key:visible')).toContainText('Ковёр на полу');
  await steps(page).getByRole('button', { name: /Мебель/ }).click();
  await expect(page.locator('svg.plan:visible')).toHaveCount(1);
  await expect(page.locator('svg.plan:visible .plan__rug')).toHaveCount(0);
});

test('без списка ковры и мебель не меняют RT60; со списком меняются средние частоты, а бас — нет', async ({ page }) => {
  await page.goto('/#room');
  const before = await Promise.all([0, 1, 3, 4].map((i) => rtCell(page, i).textContent()));
  await page.goto('/#room/floor');
  await page.getByRole('button', { name: 'Добавить ковёр', exact: true }).click();
  await steps(page).getByRole('button', { name: /Мебель/ }).click();
  await page.getByRole('button', { name: 'Добавить мебель', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Диван сложенный', exact: true }).click();
  const sofa = page.locator('.zone-card').filter({ has: page.getByLabel('Что это 1', { exact: true }) });
  await expect(sofa).toContainText('Учтётся в RT60, если включить «Указать мебель списком»');
  const status = page.getByText(/^RT60 на 500–1000 Гц:/);
  await expect(status).toHaveText('RT60 на 500–1000 Гц: 0,51 с');
  // шкаф не влияет ни в каком режиме
  await page.getByRole('button', { name: 'Добавить мебель', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Шкаф (МДФ)', exact: true }).click();
  await page.getByLabel('Указать мебель списком').check();
  await expect(sofa).toContainText(/Вклад в поглощение: (сильно|заметно)/);
  await expect(status).not.toHaveText('RT60 на 500–1000 Гц: 0,51 с');
  const listed = await status.textContent();
  await page.locator('.zone-card').filter({ hasText: 'В расчёте звука не учитывается' }).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(status).toHaveText(listed!);
  // бас (63 и 125 Гц) — прежний, средние частоты — другие
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
  const after = await Promise.all([0, 1, 3, 4].map((i) => rtCell(page, i).textContent()));
  expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
  expect(after.slice(2)).not.toEqual(before.slice(2));
});

test('пояснение «Почему учитывается только эта мебель» свёрнуто; касание предмета на плане выбирает карточку', async ({ page }) => {
  await page.goto('/#room/furniture');
  const why = page.locator('details').filter({ hasText: 'Почему учитывается только эта мебель' });
  await expect(why).not.toHaveAttribute('open', '');
  await expect(why.getByText(/рассеивают/)).toBeHidden();
  await why.locator('summary').click();
  await expect(why.getByText(/рассеивают/)).toBeVisible();
  for (const name of ['Кровать', 'Мягкое кресло']) {
    await page.getByRole('button', { name: 'Добавить мебель', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  const chair = page.locator('.zone-card').filter({ has: page.getByLabel('Что это 2', { exact: true }) });
  await chair.getByLabel('От передней стены', { exact: true }).fill('0,2');
  await chair.getByLabel('От передней стены', { exact: true }).blur();
  await page.locator('svg.plan:visible .plan__zone-rect', { hasText: 'Кровать' }).click();
  const bed = page.locator('.zone-card').filter({ has: page.getByLabel('Что это 1', { exact: true }) });
  await expect(bed).toHaveClass(/is-selected/);
  await expect(chair).not.toHaveClass(/is-selected/);
  // поворот на 90° меняет размеры местами
  await bed.getByRole('button', { name: 'Повернуть на 90°' }).click();
  await expect(bed.getByLabel('Длина вдоль передней', { exact: true })).toHaveValue('2');
  await expect(bed.getByLabel('Глубина', { exact: true })).toHaveValue('1,6');
});
