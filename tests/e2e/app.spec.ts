import { test, expect } from '@playwright/test';

// Сквозные сценарии quickstart.md в эмуляции iPhone.
// Перед запуском: npm run fixtures (создаёт tests/fixtures/out/sample-room.obj).

test('US1: моды по ручным размерам', async ({ page }) => {
  await page.goto('/#room/size');
  await page.getByLabel('Глубина', { exact: true }).fill('5');
  await page.getByLabel('Ширина', { exact: true }).fill('4');
  await page.getByLabel('Высота', { exact: true }).fill('2,5');
  await page.getByRole('button', { name: 'Анализ', exact: true }).click();
  await page.getByRole('navigation', { name: 'Раздел анализа' }).getByRole('button', { name: 'Моды', exact: true }).click();
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
  // 020: скан применяется сразу, как «Применить размеры»
  await expect(page.locator('.topbar__room')).toContainText('5,00 × 4,00 × 2,50', { timeout: 30_000 });
  await expect(page.getByTestId('scan-summary')).toContainText('sample-room.obj');
});

test('US3: неподдерживаемый файл — понятная ошибка', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', { name: 'scan.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.note--warn')).toContainText(/OBJ|поверхност/);
});

test('US4: толстый ковёр уменьшает RT60', async ({ page }) => {
  await page.goto('/#room');
  const rt = page.locator('.stat__value:visible').first();
  const before = Number((await rt.textContent())!.replace(',', '.').replace(/[^\d.]/g, ''));
  // материал пола — в конструкторе, шаг «Пол и потолок» (019)
  await page.getByRole('button', { name: 'Конструктор комнаты' }).click();
  await page.getByRole('navigation', { name: 'Шаги конструктора' }).getByRole('button', { name: /Пол и потолок/ }).click();
  await page.getByLabel('Материал пола', { exact: true }).selectOption('carpet-thick');
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
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
  await page.goto('/#tuning/sub');
  await page.getByRole('button', { name: 'Подобрать настройки' }).click();
  await expect(page.locator('.tuning-result')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByRole('button', { name: 'Применено' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Раздел настройки' }).getByRole('button', { name: /Эквалайзер/ }).click();
  await page.getByRole('button', { name: 'Рассчитать фильтры' }).click();
  await expect(page.locator('#eq-apo')).toHaveValue(/Filter 1: ON PK/);
  // экспорт в CamillaDSP: микшер на сабвуфер, эквалайзер, настройки сабвуфера
  await page.getByRole('radio', { name: 'Camilla' }).click();
  const yml = page.locator('#eq-camilla');
  await expect(yml).toHaveValue(/mixers:\n {2}room_acoustics_2to3:/);
  await expect(yml).toHaveValue(/type: Peaking/);
  await expect(yml).toHaveValue(/pipeline:\n {2}- type: Mixer/);
});

test('002 US8: импорт замера REW', async ({ page }) => {
  await page.goto('/#measure/compare');
  const lines = ['* REW export', ...Array.from({ length: 300 }, (_, i) => { const f = 10 * Math.pow(2, i / 48); return `${f.toFixed(3)} ${(80 + 6 * Math.sin(f / 7)).toFixed(2)} 0`; })];
  await page.setInputFiles('#rew-file', { name: 'rew.txt', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
  await expect(page.getByText(/Расхождение модели и замера/)).toBeVisible();
  await page.getByRole('button', { name: 'Подстроить модель' }).click();
  await expect(page.getByText(/Затухание мод ×/)).toBeVisible({ timeout: 20_000 });
});

test('003: коридор за аркой — моды системы и волновая модель', async ({ page }) => {
  await page.goto('/#room/size');
  await page.getByRole('button', { name: 'Добавить коридор' }).click();
  await expect(page.locator('svg.plan:visible .plan__ext').first()).toBeVisible();
  await page.getByRole('button', { name: 'Анализ', exact: true }).click();
  await page.getByRole('navigation', { name: 'Раздел анализа' }).getByRole('button', { name: 'Моды', exact: true }).click();
  await expect(page.locator('.sysmodes-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Расстановка' }).click();
  await page.getByRole('radio', { name: 'Вручную' }).click();
  await expect(page.locator('.best-list li').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.model-tag').first()).toContainText('волновая');
});

test('003: скан с коридором — найдены арка и коридор', async ({ page }) => {
  await page.goto('/#room');
  await page.setInputFiles('#scan-file', 'tests/fixtures/out/sample-corridor.obj');
  // 020: применено сразу; коридор — в модели, подробности — в «Поправить границы комнаты»
  await expect(page.locator('.topbar__room')).toContainText(/5,00 × (3,99|4,00)/, { timeout: 30_000 });
  await expect(page.getByTestId('scan-summary')).toContainText('коридоров и ниш — 1');
  await page.getByRole('button', { name: 'Поправить границы комнаты' }).click();
  await expect(page.locator('.layout-editor')).toBeVisible();
  await expect(page.getByText(/Коридор за .* стеной/)).toBeVisible();
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('.topbar__room')).toContainText(/5,00 × (3,99|4,00)/);
  await expect(page.getByTestId('scan-summary')).toContainText('коридоров и ниш — 1');
});

test('версия приложения видна на экране «Проекты»', async ({ page }) => {
  await page.goto('/#projects');
  await expect(page.locator('.app-version')).toContainText(/Версия от .*\(\w+\)/);
});

test('004: экран 3D — поле, способы показа, порог и срез', async ({ page }) => {
  await page.goto('/#field');
  await expect(page.locator('.field3d')).toBeVisible();
  const picks = page.locator('.freq-picks [role="radio"]');
  await expect(picks.and(page.locator('[aria-checked="true"]'))).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.field3d__busy')).toHaveCount(0, { timeout: 30_000 });
  // одна частота: кнопка выбирает её (выбрана ровно одна), подпись — что показано
  const second = picks.nth(1);
  const f2 = (await second.textContent())!.match(/\d+,\d/)![0];
  await second.click();
  await expect(picks.and(page.locator('[aria-checked="true"]'))).toHaveCount(1);
  await expect(page.locator('.field-shown')).toContainText(`Показано: ${f2} Гц`, { timeout: 30_000 });
  // вернуться к первой — уже посчитана, без пересчёта
  await picks.first().click();
  await expect(page.locator('.field3d__busy')).toHaveCount(0);
  // ползунок: любая частота, между модами
  await page.locator('#field-slider').fill('500');
  await expect(page.locator('.field-shown')).not.toContainText(f2, { timeout: 30_000 });
  await page.getByRole('radio', { name: 'Полоса' }).click();
  await page.getByRole('radio', { name: '±3' }).click();
  await expect(page.locator('.field3d__busy')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.plan__field rect').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Раздел анализа' }).getByRole('button', { name: 'Моды', exact: true }).click();
  await expect(page.locator('.modes-table')).toBeVisible();
  await page.getByRole('button', { name: 'Проекты' }).click();
  await expect(page.locator('.app-version')).toBeVisible();
});

test('005: меню слева открывает новые разделы', async ({ page }) => {
  await page.goto('/#room');
  for (const [item, check] of [
    ['Измерения', '.screen >> text=Замер свипом'],
    ['Отчёт', '.report__title'],
    ['Импорт и экспорт', 'text=Синхронизация через Файлы'],
    ['Помощник и словарь', 'text=Словарь терминов'],
    ['О приложении', '.app-version'],
  ] as const) {
    await page.getByRole('button', { name: 'Открыть меню' }).click();
    await page.locator('.drawer__item', { has: page.locator('.drawer__label', { hasText: new RegExp(`^${item}$`) }) }).click();
    await expect(page.locator(check).first()).toBeVisible({ timeout: 15_000 });
  }
});

test('005: обзор — оценка, проблемы, затухание мод', async ({ page }) => {
  await page.goto('/#overview');
  await expect(page.locator('.score-ring__num')).toBeVisible();
  await expect(page.locator('.decay-chart__pt').first()).toBeAttached();
});

test('005: тон моды и мини-плеер', async ({ page }) => {
  await page.goto('/#analysis');
  test.skip(!await page.evaluate(() => typeof AudioContext !== 'undefined'), 'Web Audio unavailable in this browser build (Windows WebKit).');
  await page.getByRole('navigation', { name: 'Раздел анализа' }).getByRole('button', { name: 'Моды', exact: true }).click();
  await page.locator('.modes-table .play-btn').first().click();
  await expect(page.locator('.miniplayer')).toBeVisible();
  await page.locator('.miniplayer').getByRole('button', { name: 'Стоп' }).click();
  await expect(page.locator('.miniplayer')).toHaveCount(0);
});

test('005: план обработки, скос потолка и помощник', async ({ page }) => {
  await page.goto('/#tuning/treatment');
  await page.getByRole('button', { name: 'Предложить план' }).click();
  await expect(page.locator('.treat-compare')).toBeVisible();
  await expect(page.locator('.plan__treat').first()).toBeAttached();
  await page.goto('/#room/floor');
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
  await page.goto('/#tuning/sub');
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
  await page.goto('/#tuning/treatment');
  await page.getByRole('button', { name: 'Предложить план' }).click();
  await expect(page.locator('.treat-compare')).toBeVisible();
  await expect(page.locator('.whatif-strip')).toHaveCount(0);
  await page.getByText('Учесть обработку в расчёте (что если)').click();
  await page.getByRole('button', { name: 'Анализ', exact: true }).click();
  await page.getByRole('navigation', { name: 'Раздел анализа' }).getByRole('button', { name: 'Моды', exact: true }).click();
  await expect(page.locator('.whatif-strip')).toBeVisible();
  await page.locator('.whatif-strip').getByRole('button', { name: 'Без обработки' }).click();
  await expect(page.locator('.whatif-strip')).toHaveCount(0);
});

test('UX: поля выбора не мельче 16 px (иначе Safari увеличивает страницу при касании)', async ({ page }) => {
  const sizes: number[] = [];
  for (const step of ['size', 'walls', 'floor', 'furniture']) {
    await page.goto(`/#room/${step}`);
    await expect(page.locator('.section-nav button.is-on')).toBeVisible();
    sizes.push(...await page.locator('select:visible').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize))));
  }
  expect(sizes.length).toBeGreaterThan(3);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});

test('Сообщить о проблеме: ошибка попадает в журнал, отчёт сохраняется с версией, ошибками и проектом', async ({ page }) => {
  await page.goto('/#room');
  // неподдерживаемый файл скана — запись в журнале с именем файла
  await page.setInputFiles('#scan-file', { name: 'scan.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText(/Неизвестный формат/)).toBeVisible();
  // необработанное исключение страницы
  await page.evaluate(() => { setTimeout(() => { throw new Error('проверка журнала'); }); });
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: /О приложении/ }).click();
  await expect(page.getByTestId('errlog-count')).toHaveText('Записано ошибок: 2.');
  await page.getByText('Последние ошибки', { exact: true }).click();
  await expect(page.locator('.errlog__list li').first()).toContainText('проверка журнала');
  await expect(page.locator('.errlog__list li').nth(1)).toContainText('scan.txt');
  await page.getByLabel('Что случилось (необязательно)').fill('Странный бас');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить отчёт' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^room-acoustics-report-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const rep = JSON.parse(await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8'));
  expect(rep.kind).toBe('room-acoustics-report');
  expect(rep.note).toBe('Странный бас');
  expect(rep.errors.length).toBe(2);
  expect(rep.device.userAgent).toContain('iPhone');
  expect(rep.project.project.room.depth).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Очистить журнал' }).click();
  await expect(page.getByTestId('errlog-count')).toHaveText('Ошибок пока не записано.');
});

test('До и после: второй замер сравнивается с первым, история переживает перезапуск', async ({ page }) => {
  const rew = (peak: number) => Buffer.from(['* REW export', ...Array.from({ length: 300 }, (_, i) => {
    const f = 10 * Math.pow(2, i / 48);
    const db = 80 + peak * Math.exp(-0.5 * (Math.log2(f / 45) / 0.08) ** 2) - 10 * Math.exp(-0.5 * (Math.log2(f / 90) / 0.06) ** 2);
    return `${f.toFixed(3)} ${db.toFixed(2)} 0`;
  })].join('\n'));
  await page.goto('/#measure/compare');
  await page.setInputFiles('#rew-file', { name: 'do.txt', mimeType: 'text/plain', buffer: rew(12) });
  await expect(page.getByText('do.txt')).toBeVisible();
  await expect(page.getByTestId('measure-compare')).toHaveCount(0);
  await page.setInputFiles('#rew-file', { name: 'posle.txt', mimeType: 'text/plain', buffer: rew(3) });
  const cmp = page.getByTestId('measure-compare');
  await expect(cmp).toBeVisible();
  await expect(cmp).toContainText('Сравнение с прошлым замером: do.txt');
  await expect(cmp).toContainText(/Стало ровнее на \d+,\d дБ/);
  await expect(cmp.locator('tbody tr')).toHaveCount(3);
  await page.waitForTimeout(800); // сохранение в IndexedDB
  await page.reload();
  await expect(page.getByTestId('measure-compare')).toContainText(/Стало ровнее/);
  await page.getByRole('button', { name: 'Забыть прошлые замеры' }).click();
  await expect(page.getByTestId('measure-compare')).toHaveCount(0);
});

test('009: карта звука в автоподборе обновляется при смене варианта, слои карты и осей включаются над планом', async ({ page }) => {
  await page.goto('/#placement');
  await page.getByRole('button', { name: 'Подобрать расстановку' }).click();
  await expect(page.locator('.score__value').first()).toBeVisible({ timeout: 30_000 });
  const heat = page.locator('.panel--hero .plan__heat rect');
  await expect.poll(() => heat.count(), { timeout: 20_000 }).toBeGreaterThan(100);
  const fillsOf = () => heat.evaluateAll((els) => els.slice(0, 400).map((e) => e.getAttribute('fill')).join());
  const v1 = await fillsOf();
  await page.getByRole('tab', { name: 'Вариант 2' }).click();
  await expect.poll(fillsOf, { timeout: 20_000 }).not.toBe(v1);
  // карта места сабвуфера для этого варианта
  await page.getByRole('radio', { name: 'Место сабвуфера' }).click();
  await expect.poll(() => heat.count(), { timeout: 20_000 }).toBeGreaterThan(100);
  // выключить карту, включить оси: 3 линии по длине и 3 по ширине
  await page.getByRole('button', { name: 'Карта звука' }).click();
  await expect(page.getByRole('button', { name: 'Карта звука' })).toHaveAttribute('aria-pressed', 'false');
  await expect(heat).toHaveCount(0);
  // выключена только окраска и её шкала: «Карта для» и пояснение под ним остаются и работают
  const hero = page.locator('.panel--hero');
  await expect(hero.locator('.heat-legend')).toHaveCount(0);
  await expect(hero.getByRole('radiogroup', { name: 'Карта для' })).toBeVisible();
  await expect(hero.getByRole('radio', { name: 'Место сабвуфера' })).toHaveAttribute('aria-checked', 'true');
  await expect(hero.locator('.map-help__line')).toContainText('Ищем место для сабвуфера');
  await expect(hero.getByText('Что показывает карта')).toBeVisible();
  await hero.getByRole('radio', { name: 'Место слушателя' }).click();
  await expect(hero.locator('.map-help__line')).toContainText('куда сесть');
  await expect(heat).toHaveCount(0);
  await page.getByRole('button', { name: 'Оси комнаты' }).click();
  await expect(page.locator('.panel--hero svg.plan .plan__axis')).toHaveCount(6);
  await expect(page.locator('.panel--hero svg.plan .plan__axis.is-mid')).toHaveCount(2);
  // выбор запоминается: в ручном режиме оси включены, карта выключена
  await page.getByRole('radio', { name: 'Вручную' }).click();
  // (вертикальная линия нулевой ширины для Playwright «невидима» — проверяем количество)
  await expect(page.locator('svg.plan .plan__axis')).toHaveCount(6);
  await expect(page.locator('svg.plan .plan__heat rect')).toHaveCount(0);
  // в ручном режиме при выключенной окраске выбор места, слой карты и пояснения тоже видны
  await expect(page.locator('.heat-legend')).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Что ищем' })).toBeVisible();
  await expect(page.locator('.map-help__line')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Слой карты' })).toBeVisible();
  await page.getByRole('radio', { name: 'Устойчивость' }).click();
  await expect(page.getByText(/Устойчивость: насколько меняется оценка/)).toBeVisible();
  await expect(page.locator('svg.plan .plan__heat rect')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Ровность' }).click();
  await page.getByRole('button', { name: 'Карта звука' }).click();
  await expect.poll(() => page.locator('svg.plan .plan__heat rect').count(), { timeout: 20_000 }).toBeGreaterThan(100);
});

test('009: цель подбора — меньше провалов внизу и провалы на своих модах', async ({ page }) => {
  await page.goto('/#placement');
  await page.getByRole('combobox', { name: 'Что искать' }).selectOption('lowDips');
  await page.getByRole('button', { name: 'Подобрать расстановку' }).click();
  await expect(page.locator('.score__label').first()).toHaveText('Провалы внизу', { timeout: 30_000 });
  await expect(page.locator('.score').first()).toContainText(/Неровность всей АЧХ \(с пиками\): \d+,\d дБ/);
  // моды: «Свои» начинаются с первых осевых, одну можно снять
  await page.getByRole('combobox', { name: 'Что искать' }).selectOption('modes');
  await expect(page.getByText(/Учитываются: .*\(по глубине\).*\(по ширине\).*\(по высоте\)/)).toBeVisible();
  await page.getByRole('radio', { name: 'Свои' }).click();
  const on = page.locator('.objective .chip.is-on');
  await expect(on).toHaveCount(3);
  await on.first().click();
  await expect(on).toHaveCount(2);
  await expect(page.getByText(/Учитываются: .*\(по ширине\).*\(по высоте\)/)).toBeVisible();
  await expect(page.getByText(/Учитываются: .*по глубине/)).toHaveCount(0);
  // результат устарел после смены цели
  await expect(page.getByText(/устарел|изменились/i).first()).toBeVisible();
  // цель — в общем блоке над переключателем: в ручном режиме та же
  await page.getByRole('radio', { name: 'Вручную' }).click();
  await expect(page.locator('.setup-card__summary')).toContainText('цель: без провалов на модах');
  await expect(page.getByRole('combobox', { name: 'Что искать' })).toHaveValue('modes');
});

test('011: обработка на планах — только когда учтена; оценка под галочкой; «Удалить все» с подтверждением', async ({ page }) => {
  await page.goto('/#tuning/treatment');
  // блока «Текущая расстановка» больше нет, оценка — в плане обработки и без элементов
  await expect(page.getByRole('heading', { name: 'Текущая расстановка' })).toHaveCount(0);
  await expect(page.locator('.treat-score .score__value')).not.toHaveText('…', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Предложить план' }).click();
  await expect(page.locator('.treat-score')).toContainText('не учтена');
  // галочка выключена: на «Расстановке» элементов обработки нет, в «Настройке» — есть
  expect(await page.locator('svg.plan:visible .plan__treat').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Расстановка' }).click();
  await page.getByRole('radio', { name: 'Вручную' }).click();
  await expect(page.locator('svg.plan:visible .plan__treat')).toHaveCount(0);
  await page.getByRole('button', { name: 'Настройка' }).click();
  await page.getByLabel('Учесть обработку в расчёте').check();
  await expect(page.locator('.treat-score')).toContainText('С обработкой');
  await page.getByRole('button', { name: 'Расстановка' }).click();
  await expect.poll(() => page.locator('svg.plan:visible .plan__treat').count()).toBeGreaterThan(0);
  // удалить всё: сначала отмена, потом подтверждение
  await page.getByRole('button', { name: 'Настройка' }).click();
  await page.getByRole('button', { name: 'Удалить все' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByLabel('Учесть обработку в расчёте')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить все' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить все' }).click();
  await expect(page.getByRole('button', { name: 'Предложить план' })).toBeVisible();
  await expect(page.locator('.treat-score')).toContainText('Без акустической обработки');
});

test('012: подсказка к карте «Место слушателя / сабвуфера»; шторка не пропускает касания на страницу', async ({ page, browserName }) => {
  await page.goto('/#placement');
  await page.getByRole('radio', { name: 'Вручную' }).click();
  await expect(page.locator('.map-help__line')).toContainText('куда сесть');
  await expect(page.locator('.map-help__line')).toContainText('Двигайте ⊙');
  await page.getByRole('radio', { name: 'Место сабвуфера' }).click();
  await expect(page.locator('.map-help__line')).toContainText('Двигайте С1');
  await page.getByText('Что показывает карта').click();
  await expect(page.locator('.map-help__mode.is-on')).toContainText('Место сабвуфера');
  // шторка: страница под ней заблокирована, после закрытия — на прежнем месте
  await page.getByRole('radio', { name: 'Автоподбор' }).click();
  await page.getByRole('button', { name: 'Подобрать расстановку' }).click();
  await expect(page.locator('.score__value').first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.scrollTo(0, 600));
  const y0 = await page.evaluate(() => window.scrollY);
  await page.locator('button.term').first().evaluate((e) => (e as HTMLButtonElement).click());
  await expect(page.locator('.sheet')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('fixed');
  // Playwright does not implement mouse.wheel for mobile WebKit; both engines still verify lock and restoration.
  if (browserName !== 'webkit') await page.mouse.wheel(0, 800);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
  // страница не прокрутилась колесом (800 px); небольшой сдвиг возможен, если ниже дорисовалась карта
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThan(60);
});

test('013: общий блок «Система и цель подбора» над переключателем режима; свой блок у каждого режима', async ({ page }) => {
  await page.goto('/#placement');
  const card = page.locator('details.setup-card');
  await expect(card).toHaveAttribute('open', '');
  // переключатель режима — под общим блоком
  const cardBox = await card.boundingBox();
  const sw = page.getByRole('radiogroup', { name: 'Режим расстановки' });
  expect((await sw.boundingBox())!.y).toBeGreaterThan(cardBox!.y + cardBox!.height - 1);
  // автоподбор: границы поиска — под переключателем; в ручном их нет, а общий блок тот же
  await expect(page.getByText('Только для автоподбора')).toBeVisible();
  await page.getByRole('radio', { name: 'Пара' }).click();
  await page.getByRole('radio', { name: 'Вручную' }).click();
  await expect(page.getByText('Только для автоподбора')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Пара' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'Что ищем' })).toBeVisible();
  await expect(page.getByText('Система и ограничения')).toHaveCount(0);
  // свернуть — остаётся сводка; состояние запоминается
  await page.locator('.setup-card__head').click();
  await expect(card).not.toHaveAttribute('open', '');
  await expect(page.locator('.setup-card__summary')).toContainText('пара колонок');
  await page.reload();
  await expect(page.locator('details.setup-card')).not.toHaveAttribute('open', '');
});

test('014: «Очистить» на экране комнаты; модель комнаты без скана; окно — отступ и ширина; стрелка списков с отступом', async ({ page }) => {
  await page.goto('/#room');
  // без скана — 3D-модель по введённым размерам там, где показывается скан
  const model = page.locator('#scan-panel .scan-result');
  await model.scrollIntoViewIfNeeded();
  await expect(model.locator('canvas')).toBeVisible();
  // окно: отступ и ширина; при сдвиге ширина сохраняется (019: окна — на шаге «Стены», левая стена)
  await page.goto('/#room/walls');
  await page.getByRole('radio', { name: 'Левая', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить проём', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Окно', exact: true }).click();
  const win = page.locator('.zone-card').filter({ hasText: 'Окно 1' });
  await expect(win).toContainText('от угла у стены с колонками до ближнего края окна');
  await win.getByLabel('Ширина', { exact: true }).fill('1,5');
  await win.getByLabel('Отступ', { exact: true }).fill('0,5');
  await win.getByLabel('Отступ', { exact: true }).blur();
  await expect(win.getByLabel('Ширина', { exact: true })).toHaveValue('1,5');
  // стрелка выпадающего списка: справа такой же отступ, как у текста слева
  const pad = await win.locator('.field__box--select').first().evaluate((el) => { const s = getComputedStyle(el); return [s.paddingLeft, s.paddingRight]; });
  expect(pad[1]).toBe(pad[0]);
  // скос: поля одно под другим (шаг «Пол и потолок»)
  await page.goto('/#room/floor');
  await page.getByText('Есть скос потолка (мансарда)').click();
  const low = await page.getByLabel('Высота у стены').boundingBox();
  const run = await page.getByLabel('Ширина скоса от стены').boundingBox();
  expect(run!.y).toBeGreaterThan(low!.y + low!.height);
  expect(Math.abs(run!.x - low!.x)).toBeLessThan(2);
  await page.goto('/#room/size');
  await page.getByLabel('Глубина', { exact: true }).fill('6');
  await page.getByLabel('Глубина', { exact: true }).blur();
  await expect(page.locator('.topbar__room')).toContainText('6,00 × 4,00');
  // очистить на обзоре: сначала отмена, потом подтверждение
  await page.getByRole('button', { name: /Обзор комнаты/ }).click();
  await page.getByRole('button', { name: 'Очистить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click();
  await expect(page.locator('.topbar__room')).toContainText('6,00 × 4,00');
  await page.getByRole('button', { name: 'Очистить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click();
  await expect(page.locator('.topbar__room')).toContainText('4,00 × 3,00 × 2,70 м');
  await expect(page.locator('.start-card')).toBeVisible();
  await expect(page.locator('.plan__slope')).toHaveCount(0);
  await page.goto('/#room/walls');
  await page.getByRole('radio', { name: 'Левая', exact: true }).click();
  await expect(page.locator('.zone-card:visible')).toHaveCount(0);
  await page.goto('/#room/floor');
  await expect(page.getByLabel('Есть скос потолка (мансарда)')).not.toBeChecked();
});

test('015: отражения от передней и задней стен; экран «Запись голоса» из меню — карта, место, направление, полоса частот, пересчёт при изменении комнаты', async ({ page }) => {
  // «Настройка»: точки отражений теперь и на передней, и на задней стене
  await page.goto('/#tuning/treatment');
  const list = page.locator('.plain-list').first();
  await expect(list).toContainText('передняя стена');
  await expect(list).toContainText('задняя стена');
  // «Запись голоса» — пункт меню слева
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: /Место для записи/ }).click();
  await expect(page.locator('.topbar__title')).toHaveText('Место для записи');
  const plan = page.locator('svg.plan:visible');
  await expect(plan.locator('.plan__heat rect').first()).toBeAttached({ timeout: 20_000 });
  await expect(plan.locator('.plan__singer')).toHaveCount(1);
  await expect(page.locator('.score__value:visible').first()).not.toHaveText('…');
  await expect(page.getByText(/^Лицом /)).toBeVisible();
  // поворот меняет направление
  const before = await page.getByText(/^Лицом /).textContent();
  await page.getByRole('button', { name: 'Правее ↻' }).click();
  await page.getByRole('button', { name: 'Правее ↻' }).click();
  await expect(page.getByText(/^Лицом /)).not.toHaveText(before!);
  // своя полоса частот, сброс к 80–12 000
  await page.getByLabel('Нижняя частота').fill('300');
  await page.getByLabel('Верхняя частота').fill('3000');
  await expect(page.getByText(/300–3.?000 Гц, полосы 1\/6 октавы/)).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть 80–12 000 Гц' }).click();
  await expect(page.getByLabel('Нижняя частота')).toHaveValue('80');
  // суперкардиоида — другое описание
  await page.getByRole('radio', { name: 'Суперкардиоида' }).click();
  await expect(page.getByText(/задний лепесток/)).toBeVisible();
  // встать в лучшее место № 2
  await page.locator('.best-list li').nth(1).getByRole('button', { name: 'Встать сюда' }).click();
  // комната меняется — экран считает заново: окно на стене напротив появляется в списке отражений
  await page.getByRole('button', { name: 'Комната' }).click();
  await page.getByRole('button', { name: 'Конструктор комнаты' }).click();
  await page.getByLabel('Глубина', { exact: true }).fill('4');
  await page.getByLabel('Ширина', { exact: true }).fill('3');
  await page.getByRole('navigation', { name: 'Шаги конструктора' }).getByRole('button', { name: /Стены/ }).click();
  await page.getByRole('radio', { name: 'Левая', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить проём', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Окно', exact: true }).click();
  const win = page.locator('.zone-card').filter({ hasText: 'Окно 1' });
  await win.getByLabel('Отступ', { exact: true }).fill('0');
  await win.getByLabel('Ширина', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: /Место для записи/ }).click();
  await expect(page.locator('.topbar__room')).toContainText('4,00 × 3,00');
  await expect(page.locator('.voice-refl')).toContainText('на окне');
});
