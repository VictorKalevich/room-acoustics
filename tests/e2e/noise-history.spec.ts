import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { exportRecord } from '../../src/core/noiseFile';
import { BUILD, legacyExport, sessionRecord, testProfile, toneMeter } from '../fixtures/noise';
import { fitsWidth, installInput, openDetail } from './helpers';

// 056: история шумомера. Файлы — тем же кодом, что в приложении, без микрофона.
const loud = exportRecord(sessionRecord(toneMeter({ seconds: 8, amp: 0.1 }), { id: 'e2e-loud-48000', name: 'Громко 48 кГц' }), BUILD);
const quiet = exportRecord(sessionRecord(toneMeter({ seconds: 8, fs: 44100, amp: 0.05 }), { id: 'e2e-quiet-44100', name: 'Тихо 44,1 кГц' }), BUILD);
const old = JSON.stringify(legacyExport(toneMeter({ seconds: 6, amp: 0.1, profile: testProfile }), 'A', 'session', 'Старый экспорт'));
const json = (name: string, text: string) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

const start = (page: Page) => page.getByRole('button', { name: 'Начать', exact: true });
const library = (page: Page) => page.getByRole('dialog', { name: 'Сохранённые измерения', exact: true });
/** Следующий файл — после завершения предыдущей операции: кнопка импорта снова доступна. */
async function importFile(page: Page, file: ReturnType<typeof json>) {
  const lib = library(page);
  await expect(lib.getByRole('button', { name: 'Импорт JSON', exact: true })).toBeEnabled();
  await lib.getByLabel('Файл измерения JSON', { exact: true }).setInputFiles(file);
}
async function download(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await click();
  const saved = await pending;
  return { name: saved.suggestedFilename(), text: await readFile((await saved.path())!, 'utf8') };
}
const noMicrophone = (page: Page) => expect.poll(() => page.locator('body').getAttribute('data-requests')).toBeNull();

test('056 · запись в историю, перезапуск, просмотр всех представлений, переименование, экспорт и удаление', async ({ page }) => {
  await page.goto('/#noise');
  if (!await installInput(page, 'tone')) test.skip(true, 'Нет виртуального входа в этом движке: сохранение проверяется импортом.');
  await expect(page.getByRole('button', { name: 'Сохранить в историю' })).toBeDisabled();
  await start(page).click();
  await expect(page.getByText(/Время принятого сигнала · ([4-9]|\d\d)\.\d с/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Сохранить в историю' })).toBeDisabled();
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  await page.getByLabel('Название измерения').fill('Тест истории');
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  await expect(page.getByText('Сохранено в историю: «Тест истории»')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить в историю' }).click();
  await expect(page.getByText('Это измерение уже есть в истории.')).toBeVisible();
  const extended = await download(page, () => page.getByRole('button', { name: 'Расширенный JSON' }).click());
  expect(extended.name).toMatch(/^Тест[ _]истории-session\.json$/);
  const file = JSON.parse(extended.text);
  expect(file).toMatchObject({ kind: 'room-acoustics/noise-export', schema: 4 });
  expect(extended.text).not.toMatch(/deviceId|groupId|"label"/i);
  // Без записи звука: в снимке только суммы, счётчики и спектры.
  expect(Object.keys(file.record.content.session)).toEqual(['kind', 'version', 'meta', 'capture', 'settings', 'calibration', 'units', 'totals', 'blocks', 'timeline', 'spectra']);

  // Перезапуск: данные из IndexedDB, микрофон при просмотре не запрашивается.
  await page.reload();
  await installInput(page, 'deny');
  await expect(page.locator('.setting-link', { hasText: 'Сохранённые измерения' })).toContainText('Измерений: 1');
  const lib = await openDetail(page, 'Сохранённые измерения');
  await expect(lib.getByText(/Измерений: 1 из 500/)).toBeVisible();
  await expect(lib.getByText(/не удаляются автоматически/)).toBeVisible();
  await expect(lib.locator('.setting-link', { hasText: 'Тест истории' })).toContainText(/Z -9\.\d · A -9\.\d · C -9\.\d dBFS/);
  const record = await openDetail(page, 'Тест истории');
  await expect(record.getByRole('row', { name: /^Источник/ })).toContainText('сеанс шумомера');
  await expect(record.getByText(/dBFS, не дБ SPL/).first()).toBeVisible();
  await expect(record.getByText(/Без поправки микрофона/).first()).toBeVisible();
  await expect(record.getByText(/Leq за сеанс \(Z\) · -9\.[0-2] dBFS/)).toBeVisible();
  await expect(record.getByRole('img', { name: 'Спектр входного сигнала' })).toBeVisible();
  await expect(record.getByRole('img', { name: 'История RMS' })).toBeVisible();
  await record.getByLabel('Частотное взвешивание').selectOption('A');
  await record.getByLabel('Спектр и полосы').selectOption('10');
  await expect(record.getByText(/PSD \(A\)/)).toBeVisible();
  await expect(record.getByText(/Диагностика аудиотракта/)).toBeVisible();
  const timeline = await openDetail(page, 'Спектрограмма и история уровней');
  await expect(timeline.getByText(/Сохранённое измерение/)).toBeVisible();
  await expect(timeline.getByRole('img', { name: 'Спектрограмма (A)' })).toBeVisible();
  await expect(timeline.getByRole('row', { name: /^Наибольшая полоса/ })).toContainText(/1(,0)? кГц/);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await fitsWidth(page)).toBe(true);
  await timeline.getByRole('button', { name: '← Назад' }).click();
  expect(await fitsWidth(page)).toBe(true);

  // CSV: метаданные единиц и веса; JSON — полная копия.
  await record.getByLabel('Таблица CSV').selectOption('levels');
  await record.getByLabel('Интервал для истории, полос и спектрограммы').selectOption('custom');
  await record.getByLabel('Начало', { exact: true }).fill('1');
  await record.getByLabel('Конец', { exact: true }).fill('3');
  const csv = await download(page, () => record.getByRole('button', { name: 'Сохранить CSV' }).click());
  expect(csv.name).toMatch(/^Тест[ _]истории-levels\.csv$/);
  expect(csv.text.startsWith('﻿# Room Acoustics · шумомер · временная история')).toBe(true);
  expect(csv.text).toContain('не дБ SPL');
  expect(csv.text).toContain('t_start_s,t_end_s,accepted_s,spectral_s,leq_1s_a_dbfs');
  expect(csv.text.slice(1).trimEnd().split('\r\n').filter(l => !l.startsWith('#')).length).toBe(3);
  const backup = await download(page, () => record.getByRole('button', { name: 'Сохранить расширенный JSON' }).click());
  // Тот же сеанс: копия из истории и расширенный JSON с экрана совпадают по данным, различается только момент снимка.
  const stored = JSON.parse(backup.text).record;
  expect(stored.id).toBe(file.record.id);
  for (const key of ['settings', 'totals', 'blocks', 'timeline', 'spectra', 'capture'])
    expect(stored.content.session[key]).toEqual(file.record.content.session[key]);

  await record.getByLabel('Название', { exact: true }).fill('Переименовано');
  await record.getByRole('button', { name: 'Переименовать' }).click();
  await expect(page.getByText('Название сохранено')).toBeVisible();
  // Открытая запись остаётся открытой под новым названием.
  const named = page.getByRole('dialog', { name: 'Переименовано', exact: true });
  await named.getByRole('button', { name: '← Назад' }).click();
  await expect(lib.locator('.setting-link', { hasText: 'Переименовано' })).toBeVisible();
  await page.reload();
  await installInput(page, 'deny');
  await openDetail(page, 'Сохранённые измерения');
  await openDetail(page, 'Переименовано');
  await named.getByRole('button', { name: 'Удалить измерение' }).click();
  const sheet = page.getByRole('alertdialog', { name: 'Удалить измерение?' });
  await expect(sheet).toContainText('«Переименовано»');
  await sheet.getByRole('button', { name: 'Отмена' }).click();
  await named.getByRole('button', { name: 'Удалить измерение' }).click();
  await sheet.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Измерение удалено')).toBeVisible();
  await expect(lib.getByText(/Сохранённых измерений нет/)).toBeVisible();
  await noMicrophone(page);
});

test('056 · импорт schema 4 и 3, повторный импорт, повреждённые файлы и сравнение', async ({ page }) => {
  await page.goto('/#noise');
  await installInput(page, 'deny');
  const lib = await openDetail(page, 'Сохранённые измерения');
  await expect(lib.getByText(/Сравнения нужны два|Для сравнения нужны два/)).toBeVisible();
  await importFile(page, json('loud.json', loud));
  await expect(lib.getByText('Импортировано: «Громко 48 кГц», schema 4')).toBeVisible();
  await importFile(page, json('quiet.json', quiet));
  await importFile(page, json('old.json', old));
  await expect(lib.getByText('Импортировано: «Старый экспорт», schema 3')).toBeVisible();
  await expect(lib.locator('.setting-link', { hasText: 'Старый экспорт' })).toContainText('импорт schema 3');

  // Повторный импорт не перезаписывает без выбора.
  const conflict = page.getByRole('alertdialog', { name: 'Измерение уже есть в истории' });
  await importFile(page, json('loud.json', loud));
  await conflict.getByRole('button', { name: 'Не импортировать' }).click();
  await importFile(page, json('loud.json', loud));
  await conflict.getByRole('button', { name: 'Сохранить копией' }).click();
  await expect(lib.locator('.setting-link', { hasText: 'Громко 48 кГц' })).toHaveCount(2);
  await importFile(page, json('loud.json', loud));
  await conflict.getByRole('button', { name: 'Заменить' }).click();
  await expect(lib.getByRole('button', { name: 'Импорт JSON', exact: true })).toBeEnabled();
  await expect(lib.locator('.setting-link', { hasText: 'Громко 48 кГц' })).toHaveCount(2);
  await expect(lib.getByText(/Измерений: 4 из 500/)).toBeVisible();

  await importFile(page, json('broken.json', loud.slice(0, 2000)));
  await expect(lib.getByText(/Файл повреждён/)).toBeVisible();
  await importFile(page, json('project.json', JSON.stringify({ format: 'room-acoustics-project', version: 7 })));
  await expect(lib.getByText(/Это файл проекта комнаты/)).toBeVisible();
  await importFile(page, json('future.json', JSON.stringify({ ...JSON.parse(loud), schema: 5 })));
  await expect(lib.getByText(/более новой версией приложения/)).toBeVisible();

  // Импорт schema 3: только данные файла.
  const legacy = await openDetail(page, 'Старый экспорт');
  await expect(legacy.getByText(/спектрограммы, истории Leq 1\/10\/60 с.*не восстанавливаются/)).toBeVisible();
  await expect(legacy.getByText(/Спектрограмма и история уровней недоступны/)).toBeVisible();
  await expect(legacy.getByLabel('Частотное взвешивание').locator('option')).toHaveText(['A']);
  await expect(legacy.getByRole('img', { name: 'Спектр входного сигнала' })).toBeVisible();
  await expect(legacy.getByLabel('Таблица CSV').locator('option')).toHaveCount(3);
  await legacy.getByRole('button', { name: '← Назад' }).click();

  const compare = await openDetail(page, 'Сравнить два измерения');
  await selectRecord(compare, 'Измерение A', 'Громко 48 кГц');
  await selectRecord(compare, 'Измерение B', 'Тихо 44,1 кГц');
  await expect(compare.getByText(/Разные частоты дискретизации \(48000 и 44100 Гц\)/)).toBeVisible();
  await expect(compare.getByRole('img', { name: 'Наложение спектров' })).toBeVisible();
  await expect(compare.getByRole('img', { name: 'Разница B − A' })).toBeVisible();
  await expect(compare.getByText(/A · Громко 48 кГц/)).toBeVisible();
  await expect(compare.getByRole('row', { name: /^Leq Z/ })).toContainText('−6.0');
  await expect(compare.getByRole('row', { name: /^Частота/ })).toContainText('44100 Гц');
  await selectRecord(compare, 'Измерение B', 'Старый экспорт');
  await expect(compare.getByText(/Разные веса \(Z и A\)/)).toBeVisible();
  await expect(compare.getByRole('img', { name: 'Наложение спектров' })).toHaveCount(0);
  await compare.getByRole('radio', { name: 'A', exact: true }).click();
  await expect(compare.getByRole('img', { name: 'Наложение спектров' })).toBeVisible();
  await expect(compare.getByText(/Вход, модель или обработка различаются или неизвестны/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await fitsWidth(page)).toBe(true);
  await noMicrophone(page);
});

async function selectRecord(dialog: Locator, label: string, name: string) {
  const select = dialog.getByLabel(label, { exact: true });
  const value = await select.locator('option', { hasText: name }).first().getAttribute('value');
  await select.selectOption(value!);
}

test('056 · история доступна без сети после установки приложения', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit не перезагружает страницу без сети через Service Worker (internal error); офлайн на iPhone — в блоке 4.');
  // Service Worker сборки регистрируется по HTTPS или на localhost с ?sw (src/main.tsx).
  await page.goto('http://localhost:4173/?sw#noise');
  const ready = await page.evaluate(() => 'serviceWorker' in navigator && Promise.race([
    navigator.serviceWorker.ready.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 15000))]));
  test.skip(!ready, 'Service Worker недоступен в этом движке Playwright.');
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  let lib = await openDetail(page, 'Сохранённые измерения');
  await importFile(page, json('loud.json', loud));
  await expect(lib.getByText('Импортировано: «Громко 48 кГц», schema 4')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  lib = await openDetail(page, 'Сохранённые измерения');
  await expect(lib.getByText(/Измерений: 1 из 500/)).toBeVisible();
  const record = await openDetail(page, 'Громко 48 кГц');
  await expect(record.getByRole('img', { name: 'Спектр входного сигнала' })).toBeVisible();
  await context.setOffline(false);
});
