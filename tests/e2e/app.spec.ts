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

test('004: экран 3D — поле, способы показа, порог и срез', async ({ page }) => {
  await page.goto('/#field');
  await expect(page.locator('.field3d')).toBeVisible();
  await expect(page.locator('.chip.is-on').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.field3d__busy')).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole('radio', { name: 'Средняя энергия' }).click();
  await page.getByRole('radio', { name: 'Полоса' }).click();
  await page.getByRole('radio', { name: '±3' }).click();
  await expect(page.locator('.field3d__busy')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.plan__field rect').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Список' }).click();
  await expect(page.locator('.modes-table')).toBeVisible();
  await page.getByRole('button', { name: 'Проекты' }).click();
  await expect(page.locator('.app-version')).toBeVisible();
});

test('005: меню слева открывает новые разделы', async ({ page }) => {
  await page.goto('/#room');
  for (const [item, check] of [
    ['Замер', '.screen >> text=Замер свипом'],
    ['Отчёт', '.report__title'],
    ['Синхронизация', 'text=Синхронизация через Файлы'],
    ['Помощник и словарь', 'text=Словарь терминов'],
    ['О приложении', '.app-version'],
  ] as const) {
    await page.getByRole('button', { name: 'Открыть меню' }).click();
    await page.locator('.drawer__item', { has: page.locator('.drawer__label', { hasText: new RegExp(`^${item}$`) }) }).click();
    await expect(page.locator(check).first()).toBeVisible({ timeout: 15_000 });
  }
});

test('005: обзор — оценка, проблемы, затухание мод; тон моды', async ({ page }) => {
  await page.goto('/#overview');
  await expect(page.locator('.score-ring__num')).toBeVisible();
  await expect(page.locator('.decay-chart__pt').first()).toBeAttached();
  await page.getByRole('radio', { name: 'Список' }).click();
  await page.locator('.modes-table .play-btn').first().click();
  await expect(page.locator('.miniplayer')).toBeVisible();
  await page.locator('.miniplayer').getByRole('button', { name: 'Стоп' }).click();
  await expect(page.locator('.miniplayer')).toHaveCount(0);
});

test('005: план обработки, скос потолка и помощник', async ({ page }) => {
  await page.goto('/#tuning');
  await page.getByRole('button', { name: 'Предложить план' }).click();
  await expect(page.locator('.treat-compare')).toBeVisible();
  await expect(page.locator('.plan__treat').first()).toBeAttached();
  await page.goto('/#room');
  await page.getByText('Есть скос потолка (мансарда)').click();
  await expect(page.locator('.plan__slope').first()).toBeAttached();
  await page.goto('/#help');
  await page.getByText('Показывать подсказку текущего шага сверху экрана').click();
  await expect(page.locator('.wizard-strip')).toBeVisible();
});

test('аудит: свои фильтры сабвуфера — возможности, подбор, применение', async ({ page }) => {
  await page.goto('/#placement');
  await page.getByText('Регулировки сабвуфера').click();
  await page.locator('.sub-caps').first().getByRole('radio', { name: '4' }).click();
  await page.getByText('Есть all-pass (фазовый) фильтр').first().click();
  await page.goto('/#tuning');
  await page.getByText('Дополнительно: свои PEQ и all-pass для каждого сабвуфера').click();
  await page.getByRole('button', { name: 'Подобрать фильтры сабвуферов' }).click();
  await expect(page.locator('.subf .stat-row')).toBeVisible({ timeout: 30_000 });
  await page.locator('.subf').getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.subf').getByRole('button', { name: 'Применено' })).toBeVisible();
});

test('аудит: синхронизация — открыть файл другого проекта', async ({ page }) => {
  await page.goto('/#sync');
  // файл с другим проектом (минимальный корректный)
  const file = JSON.stringify({ format: 'room-acoustics-project', version: 4, project: { id: 'other', name: 'Дача', updatedAt: '2026-11-01T10:00:00.000Z', room: { depth: 6, width: 4.5, height: 2.7 } } });
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: 'dacha.roomacoustics.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.getByText('В файле другой проект — «Дача»')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.topbar__room')).toContainText('Дача, 6,00 × 4,50 × 2,70');
});

test('UX: первый запуск — карточка «С чего начать» ведёт к размерам и исчезает, когда комната задана', async ({ page }) => {
  await page.goto('/#room');
  await expect(page.locator('.start-card')).toBeVisible();
  await page.locator('.start-card').getByRole('button', { name: 'Ввести размеры' }).click();
  await expect(page.getByLabel('Глубина', { exact: true })).toBeFocused();
  await page.getByLabel('Глубина', { exact: true }).fill('6');
  await expect(page.locator('.start-card')).toHaveCount(0);
});

test('UX: найденный вариант становится текущей расстановкой, другой — по кнопке', async ({ page }) => {
  await page.goto('/#placement');
  await page.getByRole('button', { name: 'Подобрать расстановку' }).click();
  await expect(page.getByText('Это текущая расстановка')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Вариант 2' }).click();
  await page.getByRole('button', { name: 'Использовать этот вариант' }).click();
  await expect(page.getByText('Это текущая расстановка')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше: «Настройка»' }).click();
  await expect(page.locator('.topbar__title')).toHaveText('Настройка');
});

test('UX: предложенный план обработки не меняет расчёты, пока не включён; включённый — виден на всех экранах', async ({ page }) => {
  await page.goto('/#tuning');
  await page.getByRole('button', { name: 'Предложить план' }).click();
  await expect(page.locator('.treat-compare')).toBeVisible();
  await expect(page.locator('.whatif-strip')).toHaveCount(0);
  await page.getByText('Учесть обработку в расчёте (что если)').click();
  await page.getByRole('button', { name: 'Моды' }).click();
  await expect(page.locator('.whatif-strip')).toBeVisible();
  await page.locator('.whatif-strip').getByRole('button', { name: 'Без обработки' }).click();
  await expect(page.locator('.whatif-strip')).toHaveCount(0);
});

test('UX: поля выбора не мельче 16 px (иначе Safari увеличивает страницу при касании)', async ({ page }) => {
  await page.goto('/#room');
  const sizes = await page.locator('select').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBeGreaterThan(3);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});
