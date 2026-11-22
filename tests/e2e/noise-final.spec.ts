import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportRecord } from '../../src/core/noiseFile';
import { BUILD, sessionRecord, toneMeter } from '../fixtures/noise';
import { fitsWidth, installInput, openDetail } from './helpers';

// 058: регрессии итогового ревью шумомера.
const long = 'Гостиная_диван_центр_ночь_окна_закрыты_шумомер_итоговая_проверка_20261123';
const stored = exportRecord(sessionRecord(toneMeter({ seconds: 8, amp: 0.1 }), { id: 'e2e-final-48000', name: long }), BUILD);

const start = (page: Page) => page.getByRole('button', { name: 'Начать', exact: true });
const library = (page: Page) => page.getByRole('dialog', { name: 'Сохранённые измерения', exact: true });
/** Сигнал «модуль новой версии не загрузился» — тот же путь перезапуска, что и автообновление; занятость его откладывает. */
const requestReload = (page: Page) => page.evaluate(() => {
  sessionStorage.removeItem('ra-preload-reload');
  (window as unknown as { marker: number }).marker = 1;
  dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
});
/** null — страница перезагружена; во время перехода значение ещё не прочитать. */
/** Панели фиксированы и прокручиваются сами: ширину документа их переполнение не меняет, проверяется сам элемент. */
const inside = (l: Locator) => l.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1);
const marker = (page: Page) => page.evaluate(() => (window as unknown as { marker?: number }).marker ?? null).catch(() => 'navigating');

test('058 · несохранённый остановленный сеанс удерживает перезапуск; причина недоступного сохранения; повторное сохранение после удаления', async ({ page }) => {
  // Обновления включаются только в собранной версии по HTTPS или на localhost с ?sw (src/main.tsx).
  await page.goto('http://localhost:4173/?sw#noise');
  if (!await installInput(page, 'tone')) test.skip(true, 'Нет виртуального входа в этом движке.');
  // Контроль: когда ничего не занято, тот же сигнал перезапускает страницу.
  await requestReload(page);
  await expect.poll(() => marker(page), { timeout: 10000 }).toBeNull();
  await expect(start(page)).toBeVisible();
  await installInput(page, 'tone');
  await expect(page.getByText('Сохранять пока нечего: проведите измерение — «Начать», затем «Остановить».')).toBeVisible();
  await start(page).click();
  await expect(page.getByText(/Время принятого сигнала · ([3-9]|\d\d)\.\d с/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Сохранить в историю и в расширенный JSON можно после остановки измерения.')).toBeVisible();
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  await expect(page.getByRole('button', { name: 'Сохранить в историю' })).toBeEnabled();

  // Новая версия во время остановленного, но не сохранённого сеанса: страница не перезагружается.
  await requestReload(page);
  await page.waitForTimeout(2500);
  expect(await marker(page)).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Измерение остановлено' })).toBeVisible();

  await page.getByLabel('Название измерения').fill('Удержание обновления');
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  // Сохранено — отложенный перезапуск выполняется, запись осталась в истории.
  await expect.poll(() => marker(page), { timeout: 10000 }).toBeNull();
  await expect(start(page)).toBeVisible();
  await installInput(page, 'tone');
  const lib = await openDetail(page, 'Сохранённые измерения');
  await expect(lib.locator('.setting-link', { hasText: 'Удержание обновления' })).toBeVisible();

  // Удалённую запись живой сеанс можно сохранить снова: «уже есть в истории» — только пока запись есть.
  await lib.getByRole('button', { name: '← Назад' }).click();
  await start(page).click();
  await expect(page.getByText(/Время принятого сигнала · ([2-9]|\d\d)\.\d с/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Остановить' }).click();
  await page.getByLabel('Название измерения').fill('Сохранить снова');
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  await expect(page.getByText('Сохранено в историю: «Сохранить снова»')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  await expect(page.getByText('Это измерение уже есть в истории.')).toBeVisible();
  await openDetail(page, 'Сохранённые измерения');
  const record = await openDetail(page, 'Сохранить снова');
  await record.getByRole('button', { name: 'Удалить измерение' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить измерение?' }).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Измерение удалено')).toBeVisible();
  await library(page).getByRole('button', { name: '← Назад' }).click();
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  await expect(page.getByText('Это измерение уже есть в истории.')).toBeHidden();
  const again = await openDetail(page, 'Сохранённые измерения');
  await expect(again.locator('.setting-link', { hasText: 'Сохранить снова' })).toBeVisible();
});

test('058 · фокус в открытой записи и в подтверждении не сбивается перерисовкой живого шумомера; длинное название на 320 px', async ({ page }) => {
  await page.goto('/#noise');
  if (!await installInput(page, 'tone')) test.skip(true, 'Нет виртуального входа в этом движке: перерисовка живого сеанса не воспроизводится.');
  const lib = await openDetail(page, 'Сохранённые измерения');
  await lib.getByLabel('Файл измерения JSON', { exact: true }).setInputFiles({ name: 'long.json', mimeType: 'application/json', buffer: Buffer.from(stored) });
  await expect(lib.getByText(`Импортировано: «${long}», schema 4`)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await inside(lib.locator(':scope > .detail-page__body'))).toBe(true);
  await page.setViewportSize({ width: 393, height: 852 });
  await lib.getByRole('button', { name: '← Назад' }).click();
  await start(page).click();
  await expect(page.getByText(/Время принятого сигнала · [1-9]\.\d с/)).toBeVisible({ timeout: 15000 });
  await openDetail(page, 'Сохранённые измерения');
  const record = await openDetail(page, long);
  const name = record.getByLabel('Название', { exact: true });
  await name.focus();
  // Экран шумомера перерисовывается каждые 150–350 мс; фокус и ввод остаются в поле.
  await page.waitForTimeout(1200);
  await expect(name).toBeFocused();
  await name.pressSequentially('_2', { delay: 120 });
  await expect(name).toHaveValue(long + '_2');
  await record.getByRole('button', { name: 'Удалить измерение' }).click();
  const sheet = page.getByRole('alertdialog', { name: 'Удалить измерение?' });
  await expect(sheet.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await expect(sheet).toContainText(long);
  expect(await inside(sheet)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Удалить', exact: true })).toBeFocused();
  await page.waitForTimeout(1200);
  await expect(sheet.getByRole('button', { name: 'Удалить', exact: true })).toBeFocused();
  await sheet.getByRole('button', { name: 'Отмена' }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(record.locator(':scope > header h2')).toHaveText(long);
  expect(await inside(record.locator(':scope > header h2'))).toBe(true);
  expect(await inside(record.locator(':scope > .detail-page__body'))).toBe(true);
  expect(await fitsWidth(page)).toBe(true);
  await record.getByRole('button', { name: '← Назад' }).click();
  const item = library(page).locator('.setting-link', { hasText: long });
  await expect(item).toBeVisible();
  expect(await inside(item)).toBe(true);
  expect(await inside(library(page).locator(':scope > .detail-page__body'))).toBe(true);
  expect(await fitsWidth(page)).toBe(true);
  await library(page).getByRole('button', { name: '← Назад' }).click();
  await page.getByRole('button', { name: 'Остановить' }).click();
});
