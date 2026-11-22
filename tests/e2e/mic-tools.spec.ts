import { expect, test, type Page } from '@playwright/test';
import { fitsWidth, installInput, onDevice } from './helpers';

// 054 (C2): общий каталог микрофонных профилей в «Анализаторе», «Свипе» и «Хлопке».
const legacy = '{"name":"legacy-A","f":[30,60,120],"db":[1,2,3]}';
const shape = 'Hz,dB\n20,6\n100,0\n400,-6';
const panel = (page: Page) => page.locator('section.panel[aria-label="Микрофон и калибровка"]:visible');
const summary = (page: Page) => panel(page).locator('summary').filter({ hasText: /^Настройки следующего измерения$/ });
/** Раскрыть настройки, если они свёрнуты: инструменты сохраняют своё состояние при переходах. */
async function settings(page: Page) {
  if (!await summary(page).evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await summary(page).click();
}
const hint = (page: Page, text: RegExp) => page.locator('.note:visible').filter({ hasText: text });
const profile = (page: Page) => panel(page).getByLabel('Профиль инструмента');
const confirm = (page: Page) => panel(page).getByLabel(/Подтверждаю применимость/);

async function importShape(page: Page, name = 'c2-shape.csv') {
  await panel(page).getByText('Управление профилями и импорт', { exact: true }).click();
  await panel(page).getByLabel('Файл микрофонной калибровки').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(shape) });
  await expect(panel(page).getByLabel('Название профиля')).toHaveValue(name.replace(/\.csv$/, ''));
  await panel(page).getByLabel('Содержимое файла').selectOption('correction');
  await panel(page).getByLabel(/Это калибровка микрофона/).check();
  await panel(page).getByRole('button', { name: 'Сохранить в каталог' }).click();
  await expect(profile(page).locator('option', { hasText: name.replace(/\.csv$/, '') + ' · v1' })).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(v => {
    if (!localStorage.getItem('ra-mic-cal')) localStorage.setItem('ra-mic-cal', v);
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
  }, legacy);
});

test('C2 · один каталог во всех инструментах, независимый выбор, legacy по умолчанию и причина блокировки', async ({ page }) => {
  await page.goto('/#measure/rta');
  const original = await onDevice(page);
  await expect(panel(page)).toContainText('Действует прежняя калибровка «legacy-A»');
  await settings(page);
  await expect(profile(page)).toHaveValue('legacy');
  await importShape(page);
  // импорт не выбирает профиль ни в одном инструменте
  await expect(profile(page)).toHaveValue('legacy');
  await profile(page).selectOption({ label: 'c2-shape · v1' });
  const rta = page.getByRole('button', { name: 'Включить анализатор' });
  await expect(rta).toBeDisabled();
  await expect(hint(page, /Запуск недоступен: не подтверждена применимость профиля/)).toBeVisible();
  await summary(page).click();
  await expect(confirm(page)).toBeHidden();
  await hint(page, /Запуск недоступен/).getByRole('button', { name: 'Открыть настройку' }).click();
  await expect(confirm(page)).toBeFocused();
  await confirm(page).check();
  await expect(rta).toBeEnabled();
  await expect(hint(page, /Запуск недоступен/)).toHaveCount(0);
  await expect(panel(page)).toContainText('до сглаживания');
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await fitsWidth(page)).toBe(true);

  await page.goto('/#measure/sweep');
  await expect(panel(page)).toContainText('Действует прежняя калибровка «legacy-A»');
  await settings(page);
  await expect(profile(page)).toHaveValue('legacy');
  await expect(profile(page).locator('option', { hasText: 'c2-shape · v1' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Записать точку 1' })).toBeEnabled();

  await page.goto('/#measure/clap');
  await settings(page);
  await expect(profile(page).locator('option:checked')).toHaveText('Как раньше (без поправки)');
  await profile(page).selectOption({ label: 'c2-shape · v1' });
  await expect(panel(page)).toContainText('Расчёт RT60 прежний');
  await expect(confirm(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Записать хлопок' })).toBeEnabled();

  await page.goto('/#noise');
  await settings(page);
  await expect(profile(page)).toHaveValue('none');

  await page.goto('/#measure/rta');
  await expect(profile(page).locator('option:checked')).toHaveText('c2-shape · v1');
  await expect(rta).toBeEnabled();
  await settings(page);
  await profile(page).selectOption('legacy');
  await expect(panel(page)).toContainText('Действует прежняя калибровка «legacy-A»');
  // при возврате к профилю подтверждение требуется снова
  await profile(page).selectOption({ label: 'c2-shape · v1' });
  await expect(rta).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('ra-mic-cal'))).toBe(legacy);
  expect((await onDevice(page)).draft).toEqual(original.draft);
});

test('C2 · «Анализатор» закрывает выбор во время работы и подписывает кривые с разной поправкой', async ({ page }) => {
  await page.goto('/#measure/rta');
  await settings(page);
  await importShape(page);
  await profile(page).selectOption({ label: 'c2-shape · v1' });
  await confirm(page).check();
  if (!await installInput(page, 'tone')) return;
  const analyzer = page.locator('section.panel[aria-label="Анализатор баса"]');
  await page.getByRole('button', { name: 'Включить анализатор' }).click();
  await expect(analyzer.getByRole('img', { name: 'График АЧХ' })).toBeVisible();
  await expect(panel(page)).toContainText('Настройки входа доступны после остановки.');
  await expect(profile(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Запомнить кривую' }).click();
  await page.getByRole('button', { name: 'Выключить' }).click();
  await settings(page);
  await profile(page).selectOption('legacy');
  await page.getByRole('button', { name: 'Включить анализатор' }).click();
  await expect(analyzer.getByText(/сняты с разной микрофонной поправкой: c2-shape · v1; прежняя/)).toBeVisible();
  await page.getByRole('button', { name: 'Выключить' }).click();
  // смена аудиоустройств при работе с профилем останавливает анализатор и снимает подтверждение
  await settings(page);
  await profile(page).selectOption({ label: 'c2-shape · v1' });
  await confirm(page).check();
  await page.getByRole('button', { name: 'Включить анализатор' }).click();
  await expect(panel(page)).toContainText('Настройки входа доступны после остановки.');
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  await expect(analyzer.getByText('Список аудиоустройств изменился. Проверьте источник и начните снова.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Включить анализатор' })).toBeDisabled();
  await settings(page);
  await expect(confirm(page)).not.toBeChecked();
});

test('C2 · архив версии, используемой несколькими инструментами: блокировка, восстановление и экспорт', async ({ page }) => {
  await page.goto('/#measure/sweep');
  await settings(page);
  await importShape(page, 'c2-archive.csv');
  await profile(page).selectOption({ label: 'c2-archive · v1' });
  await page.goto('/#measure/clap');
  await settings(page);
  await profile(page).selectOption({ label: 'c2-archive · v1' });
  await panel(page).getByText('Управление профилями и импорт', { exact: true }).click();
  await panel(page).getByLabel('Запись каталога').selectOption({ label: 'c2-archive · v1' });
  await panel(page).getByRole('button', { name: 'Архивировать', exact: true }).click();
  const sheet = page.getByRole('alertdialog');
  await expect(sheet).toContainText('Свип (этот проект)');
  await expect(sheet).toContainText('Хлопок (этот проект)');
  await sheet.getByRole('button', { name: 'Архивировать' }).click();
  await expect(profile(page).locator('option:checked')).toHaveText('Выбранная версия архивирована');
  await expect(page.getByRole('button', { name: 'Записать хлопок' })).toBeDisabled();
  await expect(hint(page, /Запуск недоступен: выбранная версия профиля архивирована/)).toBeVisible();

  await panel(page).getByText('Архив профилей · 1', { exact: true }).click();
  const archive = panel(page).locator('details').filter({ has: page.locator('xpath=./summary[starts-with(normalize-space(.), "Архив профилей")]') });
  await expect(archive.getByLabel('Архивная версия').locator('option:checked')).toHaveText('c2-archive · v1');
  await expect(archive.getByRole('img', { name: 'Исходная кривая и применяемая поправка' })).toBeVisible();
  await expect(archive).toContainText('Ссылаются: Свип (этот проект), Хлопок (этот проект)');
  await expect(archive.getByRole('button', { name: /Удалить/ })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await archive.getByRole('button', { name: 'Экспорт кривой' }).click();
  expect((await download).suggestedFilename()).toMatch(/^mic-.+-v1-correction\.csv$/);
  await archive.getByRole('button', { name: 'Восстановить' }).click();
  await expect(archive.getByRole('status')).toHaveText(/Версия восстановлена с прежним номером/);
  await expect(panel(page).getByText('Архив профилей · 0', { exact: true })).toBeVisible();
  // выбор «Хлопка» снова указывает на ту же версию; «Хлопку» подтверждение не нужно
  await expect(profile(page).locator('option:checked')).toHaveText('c2-archive · v1');
  await expect(page.getByRole('button', { name: 'Записать хлопок' })).toBeEnabled();
  await page.goto('/#measure/sweep');
  await expect(profile(page).locator('option:checked')).toHaveText('c2-archive · v1');
  await expect(page.getByRole('button', { name: 'Записать точку 1' })).toBeDisabled();
  await expect(hint(page, /Запуск недоступен: не подтверждена применимость профиля/)).toBeVisible();
});

test('C2 · UX-003: подтверждение переживает перезапуск только на проверенном входе', async ({ page }) => {
  await page.goto('/#noise');
  await settings(page);
  await importShape(page, 'c2-keep.csv');
  await profile(page).selectOption({ label: 'c2-keep · v1' });
  await confirm(page).check();
  await expect(panel(page)).toContainText('Подтверждение действует до закрытия приложения');
  const start = page.getByRole('button', { name: 'Начать', exact: true });
  if (!await installInput(page, 'tone', 'virtual-1')) return;
  await start.click();
  await expect(page.getByText(/Уровень по PSD с поправкой/)).toBeVisible();
  await page.getByRole('button', { name: 'Остановить' }).click();
  await page.reload();
  await expect(start).toBeEnabled();
  await settings(page);
  await expect(confirm(page)).toBeChecked();
  await expect(panel(page)).toContainText('Подтверждение сохранится после перезапуска');
  // другой физический вход снимает подтверждение
  await installInput(page, 'tone', 'virtual-2');
  await start.click();
  await expect(page.getByText(/Вход изменился после подтверждения профиля/)).toBeVisible();
  await settings(page);
  await expect(confirm(page)).not.toBeChecked();
  await expect(start).toBeDisabled();
  // смена модели тоже требует нового подтверждения
  await confirm(page).check();
  await expect(start).toBeEnabled();
  await panel(page).getByLabel('Модель устройства').selectOption('Android');
  await expect(confirm(page)).not.toBeChecked();
  await expect(start).toBeDisabled();
});
